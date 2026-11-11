import { eq } from "drizzle-orm";
import { seedBaseline } from "../lib/db/seeds/run";
import { db } from "../lib/db";
import {
  capacityReservations,
  discountReservations,
  discounts,
  orders,
  orderStatusHistory,
  productVariants,
  roles,
  users,
} from "../lib/db/schema";
import { newId } from "../lib/ids";
import { hashPassword } from "../lib/auth/password";
import type { AuthUser } from "../lib/auth/rbac";
import { createProduct } from "../lib/services/catalog/products";
import { createVariant } from "../lib/services/catalog/variants";
import { createDiscount } from "../lib/services/discounts/service";
import { createOrder } from "../lib/services/orders/create";
import {
  cancelUnpaidOrder,
  expireUnpaidOrders,
  markOrderPaid,
  requestCancellation,
  adminUpdateOrderStatus,
} from "../lib/services/orders/lifecycle";
import {
  CapacityExceededError,
  ConflictError,
  ForbiddenError,
  ValidationError,
} from "../lib/errors";
import { ORDER_STATUSES } from "../lib/orders/constants";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function makeUser(
  roleSlug: "customer" | "admin",
  opts?: { verified?: boolean; blocked?: boolean },
): Promise<AuthUser> {
  const role = await db.query.roles.findFirst({ where: eq(roles.slug, roleSlug) });
  assert(role, `${roleSlug} role missing`);
  const id = newId();
  const suffix = id.slice(0, 8);
  await db.insert(users).values({
    id,
    username: `${roleSlug}_${suffix}`,
    email: `${roleSlug}_${suffix}@test.local`,
    firstName: "T",
    lastName: "User",
    name: "T User",
    passwordHash: await hashPassword("TestPass123!"),
    roleId: role.id,
    status: opts?.blocked ? "blocked" : "active",
    emailVerified: opts?.verified === false ? null : new Date(),
  });
  return {
    id,
    email: `${roleSlug}_${suffix}@test.local`,
    username: `${roleSlug}_${suffix}`,
    role: roleSlug,
    status: opts?.blocked ? "blocked" : "active",
    emailVerified: opts?.verified === false ? null : new Date(),
    sessionVersion: 0,
  };
}

async function main() {
  await seedBaseline();
  const admin = await makeUser("admin");
  const customer = await makeUser("customer");

  const product = await createProduct(admin, {
    categorySlug: "gift-cards-premium",
    title: "Order Test Card",
    slug: `ord-card-${newId().slice(0, 6)}`,
    serviceFeeBps: 0,
    fixedAncillaryCostToman: 0,
    config: {
      brand: "Test",
      countryOrRegion: "Global",
      productType: "gift_card",
      supportsStarsQuantity: false,
      supportsSubscriptionDuration: false,
      denominations: [10],
    },
  });

  const finite = await createVariant(admin, product.id, {
    name: "Cap 3",
    priceToman: 100_000,
    capacityMode: "finite",
    capacityTotal: 3,
    capacityRemaining: 3,
  });

  const unlimited = await createVariant(admin, product.id, {
    name: "Unlimited",
    priceToman: 50_000,
    capacityMode: "unlimited",
  });

  const discount = await createDiscount(admin, {
    code: `SAVE10_${newId().slice(0, 6)}`,
    name: "Ten percent",
    type: "percentage",
    percentageBps: 1000,
    usageLimit: 2,
    perUserLimit: 1,
    scopeType: "all",
    announce: false,
  });

  // Create order: reserves capacity + discount, 15m expiry
  const order = await createOrder(customer, {
    variantId: finite.id,
    quantity: 1,
    fieldValues: {},
    discountCode: discount.code,
    pricing: { mode: "fixed_irt" },
  });
  assert(order.status === ORDER_STATUSES.awaitingPayment, "awaiting_payment");
  assert(order.payableToman === 90_000, `payable ${order.payableToman}`);
  assert(order.discountToman === 10_000, "discount applied after base");
  assert(order.paymentExpiresAt, "paymentExpiresAt set");
  const expiresMs = new Date(order.paymentExpiresAt).getTime() - Date.now();
  assert(expiresMs > 14 * 60 * 1000 && expiresMs <= 15 * 60 * 1000, "TTL ~15m");

  const afterCreate = await db.query.productVariants.findFirst({
    where: eq(productVariants.id, finite.id),
  });
  assert(afterCreate?.capacityRemaining === 2, "capacity reserved");

  const hold = await db.query.capacityReservations.findFirst({
    where: eq(capacityReservations.orderId, order.id),
  });
  assert(hold?.status === "reserved", "capacity hold reserved");

  const dHold = await db.query.discountReservations.findFirst({
    where: eq(discountReservations.orderId, order.id),
  });
  assert(dHold?.status === "reserved", "discount hold reserved");

  // Per-user discount limit
  let perUserBlocked = false;
  try {
    await createOrder(customer, {
      variantId: unlimited.id,
      quantity: 1,
      fieldValues: {},
      discountCode: discount.code,
      pricing: { mode: "fixed_irt" },
    });
  } catch (error) {
    perUserBlocked = error instanceof CapacityExceededError;
  }
  assert(perUserBlocked, "per-user discount limit");

  // Cancel unpaid: release capacity + discount
  await cancelUnpaidOrder(customer, order.id);
  const afterCancel = await db.query.productVariants.findFirst({
    where: eq(productVariants.id, finite.id),
  });
  assert(afterCancel?.capacityRemaining === 3, "capacity restored on cancel");
  const dHoldAfter = await db.query.discountReservations.findFirst({
    where: eq(discountReservations.orderId, order.id),
  });
  assert(dHoldAfter?.status === "released", "discount released");

  // Concurrency: capacity race (3 slots, 8 contenders)
  const racers = await Promise.all(
    Array.from({ length: 8 }, () => makeUser("customer")),
  );
  const results = await Promise.allSettled(
    racers.map((u) =>
      createOrder(u, {
        variantId: finite.id,
        quantity: 1,
        fieldValues: {},
        pricing: { mode: "fixed_irt" },
      }),
    ),
  );
  const wins = results.filter((r) => r.status === "fulfilled").length;
  const capacityLosses = results.filter(
    (r) => r.status === "rejected" && r.reason instanceof CapacityExceededError,
  ).length;
  assert(wins === 3, `capacity race wins=${wins}`);
  assert(capacityLosses === 5, `capacity race losses=${capacityLosses}`);
  const racedVariant = await db.query.productVariants.findFirst({
    where: eq(productVariants.id, finite.id),
  });
  assert(racedVariant?.capacityRemaining === 0, "capacity exhausted after race");

  // Discount total usage limit race (usageLimit=2, fresh users)
  const discCode = `LIM_${newId().slice(0, 6)}`;
  await createDiscount(admin, {
    code: discCode,
    name: "Limited",
    type: "fixed",
    fixedAmountToman: 1000,
    usageLimit: 2,
    scopeType: "all",
    announce: false,
  });
  const discUsers = await Promise.all(Array.from({ length: 6 }, () => makeUser("customer")));
  const discRace = await Promise.allSettled(
    discUsers.map((u) =>
      createOrder(u, {
        variantId: unlimited.id,
        quantity: 1,
        fieldValues: {},
        discountCode: discCode,
        pricing: { mode: "fixed_irt" },
      }),
    ),
  );
  const discWins = discRace.filter((r) => r.status === "fulfilled").length;
  assert(discWins === 2, `discount race wins=${discWins}`);

  // Expire job idempotent + concurrent
  const expireCustomer = await makeUser("customer");
  const toExpire = await createOrder(expireCustomer, {
    variantId: unlimited.id,
    quantity: 1,
    fieldValues: {},
    pricing: { mode: "fixed_irt" },
  });
  await db
    .update(orders)
    .set({ paymentExpiresAt: new Date(Date.now() - 1000) })
    .where(eq(orders.id, toExpire.id));

  const [a, b] = await Promise.all([expireUnpaidOrders(50), expireUnpaidOrders(50)]);
  const expiredRow = await db.query.orders.findFirst({ where: eq(orders.id, toExpire.id) });
  assert(expiredRow?.status === ORDER_STATUSES.expired, "order expired");
  // Concurrent jobs may claim distinct overdue rows; never double-expire one order.
  const expireTransitions = await db.query.orderStatusHistory.findMany({
    where: eq(orderStatusHistory.orderId, toExpire.id),
  });
  const toExpired = expireTransitions.filter((h) => h.toStatus === ORDER_STATUSES.expired);
  assert(toExpired.length === 1, `duplicate expire transitions=${toExpired.length}`);
  assert(a.expiredCount + b.expiredCount >= 1, "at least one expire");

  // Pay then request cancel
  const payCustomer = await makeUser("customer");
  const paidOrder = await createOrder(payCustomer, {
    variantId: unlimited.id,
    quantity: 1,
    fieldValues: {},
    pricing: { mode: "fixed_irt" },
  });
  await markOrderPaid(paidOrder.id, payCustomer.id);
  const req = await requestCancellation(payCustomer, paidOrder.id, "changed mind");
  assert(req.status === ORDER_STATUSES.cancellationRequested, "cancel requested");

  await adminUpdateOrderStatus(admin, paidOrder.id, {
    status: "cancelled",
    note: "Approved by admin",
  });
  const cancelled = await db.query.orders.findFirst({ where: eq(orders.id, paidOrder.id) });
  assert(cancelled?.status === ORDER_STATUSES.cancelled, "admin cancelled");

  // Unpaid order cannot jump to completed (free fulfillment)
  const unpaidGate = await createOrder(await makeUser("customer"), {
    variantId: unlimited.id,
    quantity: 1,
    fieldValues: {},
    pricing: { mode: "fixed_irt" },
  });
  let badComplete = false;
  try {
    await adminUpdateOrderStatus(admin, unpaidGate.id, {
      status: "completed",
      note: "illegal",
    });
  } catch (error) {
    badComplete = error instanceof ValidationError;
  }
  assert(badComplete, "awaiting_payment -> completed must be rejected");

  // Unverified blocked at service layer via assertVerifiedCustomer (API); role check here
  const unverified = await makeUser("customer", { verified: false });
  let blockedUnverified = false;
  try {
    // createOrder itself does not re-check verification (API does). Role is still customer.
    // Simulate API gate:
    const { assertVerifiedCustomer } = await import("../lib/auth/rbac");
    assertVerifiedCustomer(unverified);
  } catch (error) {
    blockedUnverified = error instanceof ForbiddenError;
  }
  assert(blockedUnverified, "unverified customer blocked");

  // Double-pay conflict
  const once = await createOrder(await makeUser("customer"), {
    variantId: unlimited.id,
    quantity: 1,
    fieldValues: {},
    pricing: { mode: "fixed_irt" },
  });
  await markOrderPaid(once.id);
  let doublePay = false;
  try {
    await markOrderPaid(once.id);
  } catch (error) {
    doublePay = error instanceof ConflictError;
  }
  assert(doublePay, "double pay conflict");

  const discountRow = await db.query.discounts.findFirst({
    where: eq(discounts.id, discount.id),
  });
  assert(discountRow?.scopeType === "all", "discount scope persisted");

  console.log(
    JSON.stringify({
      ok: true,
      suite: "test-orders",
      capacityRaceWins: wins,
      discountRaceWins: discWins,
      expire: { a: a.expiredCount, b: b.expiredCount },
    }),
  );
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
