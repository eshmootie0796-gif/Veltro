import { eq } from "drizzle-orm";
import { seedBaseline } from "../lib/db/seeds/run";
import { db } from "../lib/db";
import {
  capacityReservations,
  fiatWalletTransactions,
  fiatWallets,
  orders,
  payments,
  productVariants,
  roles,
  users,
} from "../lib/db/schema";
import { newId } from "../lib/ids";
import { hashPassword } from "../lib/auth/password";
import type { AuthUser } from "../lib/auth/rbac";
import { createProduct } from "../lib/services/catalog/products";
import { createVariant } from "../lib/services/catalog/variants";
import { createOrder } from "../lib/services/orders/create";
import {
  adminUpdateOrderStatus,
  requestCancellation,
} from "../lib/services/orders/lifecycle";
import { payOrder, refundOrderPaymentInTx } from "../lib/services/payments/service";
import {
  getWallet,
  listWalletTransactions,
  mockWalletTopup,
} from "../lib/services/wallet/service";
import { withReservationTransaction } from "../lib/db/transaction";
import { ForbiddenError, InsufficientFundsError, ValidationError } from "../lib/errors";
import { ORDER_STATUSES } from "../lib/orders/constants";
import { PAYMENT_METHODS, PAYMENT_STATUSES } from "../lib/payments/constants";
import { assertManualWalletMutationForbidden } from "../lib/auth/rbac";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function makeUser(roleSlug: "customer" | "admin"): Promise<AuthUser> {
  const role = await db.query.roles.findFirst({ where: eq(roles.slug, roleSlug) });
  assert(role, `${roleSlug} role missing`);
  const id = newId();
  const suffix = id.slice(0, 8);
  await db.insert(users).values({
    id,
    username: `${roleSlug}_${suffix}`,
    email: `${roleSlug}_${suffix}@test.local`,
    firstName: "Pay",
    lastName: "User",
    name: "Pay User",
    passwordHash: await hashPassword("TestPass123!"),
    roleId: role.id,
    status: "active",
    emailVerified: new Date(),
  });
  await db.insert(fiatWallets).values({ id: newId(), userId: id, balanceToman: 0 });
  return {
    id,
    email: `${roleSlug}_${suffix}@test.local`,
    username: `${roleSlug}_${suffix}`,
    role: roleSlug,
    status: "active",
    emailVerified: new Date(),
    sessionVersion: 0,
  };
}

async function main() {
  await seedBaseline();
  const admin = await makeUser("admin");
  const customer = await makeUser("customer");

  const product = await createProduct(admin, {
    categorySlug: "gift-cards-premium",
    title: "Pay Test Card",
    slug: `pay-card-${newId().slice(0, 6)}`,
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
  const variant = await createVariant(admin, product.id, {
    name: "Pay Cap",
    priceToman: 100_000,
    capacityMode: "finite",
    capacityTotal: 5,
    capacityRemaining: 5,
  });

  // Top-up success
  const topup = await mockWalletTopup(customer, {
    amountToman: 250_000,
    simulate: "success",
  });
  assert(topup.status === PAYMENT_STATUSES.succeeded, "topup success");
  const wallet = await getWallet(customer);
  assert(wallet.balanceToman === 250_000, `balance ${wallet.balanceToman}`);

  const ledger = await listWalletTransactions(customer);
  assert(ledger[0]?.balanceBefore === 0, "balanceBefore recorded");
  assert(ledger[0]?.balanceAfter === 250_000, "balanceAfter recorded");

  // Top-up failure: no credit
  const failTop = await mockWalletTopup(customer, {
    amountToman: 20_000,
    simulate: "failure",
  });
  assert(failTop.status === PAYMENT_STATUSES.failed, "topup fail");
  assert((await getWallet(customer)).balanceToman === 250_000, "balance unchanged");

  // Top-up limits
  let badLimit = false;
  try {
    await mockWalletTopup(customer, { amountToman: 1, simulate: "success" });
  } catch (error) {
    badLimit = error instanceof ValidationError;
  }
  assert(badLimit, "below min topup rejected");

  // Wallet pay success
  const order1 = await createOrder(customer, {
    variantId: variant.id,
    quantity: 1,
    fieldValues: {},
    pricing: { mode: "fixed_irt" },
  });
  const paid = await payOrder(customer, order1.id, { method: PAYMENT_METHODS.walletFiat });
  assert(paid.status === PAYMENT_STATUSES.succeeded, "wallet pay ok");
  assert(paid.orderStatus === ORDER_STATUSES.paid, "order paid");
  assert((await getWallet(customer)).balanceToman === 150_000, "debited");

  // Insufficient funds: order stays, capacity reserved
  const order2 = await createOrder(customer, {
    variantId: variant.id,
    quantity: 1,
    fieldValues: {},
    pricing: { mode: "fixed_irt" },
  });
  // Drain wallet below payable
  await db
    .update(fiatWallets)
    .set({ balanceToman: 1_000, updatedAt: new Date() })
    .where(eq(fiatWallets.userId, customer.id));

  let insuf = false;
  try {
    await payOrder(customer, order2.id, { method: PAYMENT_METHODS.walletFiat });
  } catch (error) {
    insuf = error instanceof InsufficientFundsError;
  }
  assert(insuf, "insufficient funds");
  const stuck = await db.query.orders.findFirst({ where: eq(orders.id, order2.id) });
  assert(stuck?.status === ORDER_STATUSES.awaitingPayment, "order still awaiting");
  const hold = await db.query.capacityReservations.findFirst({
    where: eq(capacityReservations.orderId, order2.id),
  });
  assert(hold?.status === "reserved", "capacity still reserved");

  // Top up and retry same order
  await mockWalletTopup(customer, { amountToman: 200_000, simulate: "success" });
  const retried = await payOrder(customer, order2.id, { method: PAYMENT_METHODS.walletFiat });
  assert(retried.status === PAYMENT_STATUSES.succeeded, "retry after topup");

  // Mock direct failure cancels + releases, no retry
  const order3 = await createOrder(customer, {
    variantId: variant.id,
    quantity: 1,
    fieldValues: {},
    pricing: { mode: "fixed_irt" },
  });
  const beforeCap = (
    await db.query.productVariants.findFirst({ where: eq(productVariants.id, variant.id) })
  )?.capacityRemaining;
  const failedPay = await payOrder(customer, order3.id, {
    method: PAYMENT_METHODS.simulatedGateway,
    simulate: "failure",
  });
  assert(failedPay.status === PAYMENT_STATUSES.failed, "mock fail");
  assert(failedPay.orderStatus === ORDER_STATUSES.cancelled, "cancelled on fail");
  const afterCap = (
    await db.query.productVariants.findFirst({ where: eq(productVariants.id, variant.id) })
  )?.capacityRemaining;
  assert(afterCap === (beforeCap ?? 0) + 1, "capacity released on mock fail");

  let noRetry = false;
  try {
    await payOrder(customer, order3.id, {
      method: PAYMENT_METHODS.simulatedGateway,
      simulate: "success",
    });
  } catch (error) {
    noRetry = error instanceof ValidationError;
  }
  assert(noRetry, "no retry on failed direct pay order");

  // Mock success
  const order4 = await createOrder(customer, {
    variantId: variant.id,
    quantity: 1,
    fieldValues: {},
    pricing: { mode: "fixed_irt" },
  });
  const mockOk = await payOrder(customer, order4.id, {
    method: PAYMENT_METHODS.simulatedGateway,
    simulate: "success",
  });
  assert(mockOk.status === PAYMENT_STATUSES.succeeded, "mock success");

  // Refund on admin cancel (full amount to wallet)
  const balBeforeRefund = (await getWallet(customer)).balanceToman;
  await requestCancellation(customer, order4.id, "want refund");
  await adminUpdateOrderStatus(admin, order4.id, {
    status: "cancelled",
    note: "Approved refund cancel",
  });
  const balAfterRefund = (await getWallet(customer)).balanceToman;
  assert(balAfterRefund === balBeforeRefund + 100_000, "full refund to wallet");
  const refundedPay = await db.query.payments.findFirst({
    where: eq(payments.orderId, order4.id),
  });
  assert(refundedPay?.status === PAYMENT_STATUSES.refunded, "payment refunded");

  // Idempotent refund
  const again = await withReservationTransaction((tx) => refundOrderPaymentInTx(tx, order4.id));
  assert(again.refunded === false && again.reason === "already_handled", "idempotent refund");

  // Deleted account: no refund credit
  const doomed = await makeUser("customer");
  await mockWalletTopup(doomed, { amountToman: 150_000, simulate: "success" });
  const order5 = await createOrder(doomed, {
    variantId: variant.id,
    quantity: 1,
    fieldValues: {},
    pricing: { mode: "fixed_irt" },
  });
  await payOrder(doomed, order5.id, { method: PAYMENT_METHODS.walletFiat });
  await db
    .update(users)
    .set({ status: "deleted", deletedAt: new Date() })
    .where(eq(users.id, doomed.id));
  const balBeforeForfeit = (
    await db.query.fiatWallets.findFirst({ where: eq(fiatWallets.userId, doomed.id) })
  )?.balanceToman;
  await adminUpdateOrderStatus(admin, order5.id, {
    status: "rejected",
    note: "Reject after delete",
  });
  const balAfterForfeit = (
    await db.query.fiatWallets.findFirst({ where: eq(fiatWallets.userId, doomed.id) })
  )?.balanceToman;
  assert(balAfterForfeit === balBeforeForfeit, "no credit to deleted account");
  const forfeitPay = await db.query.payments.findFirst({
    where: eq(payments.orderId, order5.id),
  });
  assert(forfeitPay?.status === PAYMENT_STATUSES.forfeitedRefund, "forfeited refund");

  // No admin manual balance mutation API (guard still throws)
  let blockedAdmin = false;
  try {
    assertManualWalletMutationForbidden();
  } catch (error) {
    blockedAdmin = error instanceof ForbiddenError;
  }
  assert(blockedAdmin, "admin wallet mutation forbidden");

  // Concurrent wallet pays on one order: exactly one success
  const raceCustomer = await makeUser("customer");
  await mockWalletTopup(raceCustomer, { amountToman: 500_000, simulate: "success" });
  const raceOrder = await createOrder(raceCustomer, {
    variantId: variant.id,
    quantity: 1,
    fieldValues: {},
    pricing: { mode: "fixed_irt" },
  });
  const race = await Promise.allSettled([
    payOrder(raceCustomer, raceOrder.id, { method: PAYMENT_METHODS.walletFiat }),
    payOrder(raceCustomer, raceOrder.id, { method: PAYMENT_METHODS.walletFiat }),
    payOrder(raceCustomer, raceOrder.id, { method: PAYMENT_METHODS.walletFiat }),
  ]);
  const raceWins = race.filter((r) => r.status === "fulfilled").length;
  assert(raceWins === 1, `concurrent pay wins=${raceWins}`);
  const raceBal = (await getWallet(raceCustomer)).balanceToman;
  assert(raceBal === 400_000, `single debit balance=${raceBal}`);

  const txCount = await db.query.fiatWalletTransactions.findMany({
    where: eq(fiatWalletTransactions.userId, customer.id),
  });
  assert(txCount.every((t) => t.balanceBefore !== undefined), "ledger snapshots present");

  console.log(
    JSON.stringify({
      ok: true,
      suite: "test-payments",
      raceWins,
      refundDelta: balAfterRefund - balBeforeRefund,
    }),
  );
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
