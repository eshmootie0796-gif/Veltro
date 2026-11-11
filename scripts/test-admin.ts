import { eq, isNull } from "drizzle-orm";
import { seedBaseline } from "../lib/db/seeds/run";
import { db } from "../lib/db";
import {
  fiatWallets,
  notifications,
  orders,
  orderItems,
  productVariants,
  roles,
  users,
} from "../lib/db/schema";
import { newId } from "../lib/ids";
import { hashPassword } from "../lib/auth/password";
import {
  assertAdmin,
  assertManualWalletMutationForbidden,
  assertSuperAdmin,
  assertVerifiedCustomer,
  type AuthUser,
} from "../lib/auth/rbac";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../lib/errors";
import { ORDER_STATUSES } from "../lib/orders/constants";
import { listCustomers, getCustomerAdmin } from "../lib/services/admin/customers";
import { listOrdersAdmin } from "../lib/services/admin/orders";
import { listPaymentsAdmin, listWalletTransactionsAdmin } from "../lib/services/admin/payments";
import { listAuditLogs } from "../lib/services/admin/audit";
import { getAdminReports } from "../lib/services/admin/reports";
import { createProduct } from "../lib/services/catalog/products";
import { createVariant } from "../lib/services/catalog/variants";
import { createDiscount } from "../lib/services/discounts/service";
import {
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  getPlatformSettings,
  updatePlatformSettings,
  listNotificationTemplates,
} from "../lib/services/notifications/service";
import {
  createReview,
  getProductAverageRating,
  listPendingReviews,
  moderateReview,
} from "../lib/services/reviews/service";
import { assignUserRole, createAdminAccount } from "../lib/services/users/roles";
import { blockUser, unblockUser } from "../lib/services/users/block";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function makeUser(
  roleSlug: "customer" | "admin" | "super_admin",
  opts?: { verified?: boolean },
): Promise<AuthUser> {
  const role = await db.query.roles.findFirst({ where: eq(roles.slug, roleSlug) });
  assert(role, `${roleSlug} role missing`);
  const id = newId();
  const suffix = id.slice(0, 8);
  const email = `${roleSlug}_${suffix}@test.local`;
  const username = `${roleSlug}_${suffix}`;
  await db.insert(users).values({
    id,
    username,
    email,
    firstName: "T",
    lastName: "User",
    name: "T User",
    passwordHash: await hashPassword("TestPass123!"),
    roleId: role.id,
    status: "active",
    emailVerified: opts?.verified === false ? null : new Date(),
  });
  await db.insert(fiatWallets).values({ id: newId(), userId: id, balanceToman: 0 });
  return {
    id,
    email,
    username,
    role: roleSlug,
    status: "active",
    emailVerified: opts?.verified === false ? null : new Date(),
    sessionVersion: 0,
  };
}

async function expectForbidden(fn: () => unknown | Promise<unknown>, label: string) {
  let hit = false;
  try {
    await fn();
  } catch (error) {
    hit = error instanceof ForbiddenError;
  }
  assert(hit, `${label} must be ForbiddenError`);
}

async function main() {
  await seedBaseline();
  const suffix = newId().slice(0, 8);

  const customer = await makeUser("customer");
  const admin = await makeUser("admin");
  const superAdmin = await makeUser("super_admin");
  const otherCustomer = await makeUser("customer");

  await expectForbidden(() => assertAdmin(customer), "customer assertAdmin");
  await expectForbidden(() => assertSuperAdmin(admin), "admin assertSuperAdmin");
  await expectForbidden(() => assertVerifiedCustomer(admin), "admin as customer");
  assertAdmin(admin);
  assertAdmin(superAdmin);
  assertSuperAdmin(superAdmin);
  assertVerifiedCustomer(customer);

  let walletBlocked = false;
  try {
    assertManualWalletMutationForbidden();
  } catch (error) {
    walletBlocked = error instanceof ForbiddenError;
  }
  assert(walletBlocked, "manual wallet mutation must be forbidden");

  await expectForbidden(() => listCustomers(customer, {}), "customer listCustomers");
  const customers = await listCustomers(admin, { q: customer.username });
  assert(
    customers.items.some((c) => c.id === customer.id),
    "admin must find customer",
  );
  const detail = await getCustomerAdmin(admin, customer.id);
  assert(detail.id === customer.id, "customer detail mismatch");
  assert(detail.wallet !== null, "customer wallet missing");

  await listOrdersAdmin(admin, {});
  await listPaymentsAdmin(admin, {});
  await listWalletTransactionsAdmin(admin, { userId: customer.id });
  const reports = await getAdminReports(admin);
  assert(typeof reports.revenueToman === "number", "reports.revenueToman");
  assert(Array.isArray(reports.charts.daily), "reports.charts.daily");
  assert(typeof reports.awaitingReview === "number", "reports.awaitingReview");

  await expectForbidden(() => listAuditLogs(admin, {}), "admin listAuditLogs");
  const audits = await listAuditLogs(superAdmin, {});
  assert(Array.isArray(audits.items), "audit items");

  const settings = await getPlatformSettings(admin);
  assert(typeof settings.defaultServiceFeeBps === "number", "defaultServiceFeeBps");
  await expectForbidden(
    () => updatePlatformSettings(admin, { notificationsEnabled: true }),
    "admin updatePlatformSettings",
  );
  const updated = await updatePlatformSettings(superAdmin, {
    defaultServiceFeeBps: settings.defaultServiceFeeBps,
    notificationsEnabled: true,
  });
  assert(updated.notificationsEnabled === true, "settings update failed");

  const templates = await listNotificationTemplates(admin);
  assert(templates.length >= 9, "notification templates seeded");

  await expectForbidden(
    () =>
      createAdminAccount(admin, {
        username: `bad_${suffix}`,
        email: `bad_${suffix}@example.com`,
        password: "AdminPass123!",
        firstName: "Bad",
        lastName: "Admin",
      }),
    "admin createAdminAccount",
  );
  const createdAdmin = await createAdminAccount(superAdmin, {
    username: `adm_${suffix}`,
    email: `adm_${suffix}@example.com`,
    password: "AdminPass123!",
    firstName: "New",
    lastName: "Admin",
  });
  assert(createdAdmin.role === "admin", "createAdminAccount role");

  await expectForbidden(
    () => assignUserRole(admin, otherCustomer.id, { role: "admin" }),
    "admin assignUserRole",
  );
  await assignUserRole(superAdmin, otherCustomer.id, { role: "admin" });
  await assignUserRole(superAdmin, otherCustomer.id, { role: "customer" });

  // Last Super Admin: demote all others, then demotion of remaining must fail.
  const solo = await makeUser("super_admin");
  const activeSupers = await db.query.users.findMany({ with: { role: true } });
  const otherSupers = activeSupers.filter(
    (u) =>
      u.status === "active" &&
      u.role?.slug === "super_admin" &&
      u.id !== solo.id,
  );
  for (const u of otherSupers) {
    await assignUserRole(solo, u.id, { role: "admin" });
  }
  let lastProtected = false;
  try {
    await assignUserRole(solo, solo.id, { role: "admin" });
  } catch (error) {
    lastProtected = error instanceof ConflictError;
  }
  assert(lastProtected, "last Super Admin demotion must fail");
  for (const u of otherSupers) {
    await assignUserRole(solo, u.id, { role: "super_admin" });
  }

  await blockUser(admin, customer.id, { reason: "Phase10 block test" });
  await unblockUser(admin, customer.id, { reason: "Phase10 unblock test" });
  const blockAudits = await listAuditLogs(superAdmin, { action: "user.block" });
  assert(blockAudits.items.length >= 1, "block audit missing");

  await createDiscount(admin, {
    code: `PH10_${suffix.toUpperCase()}`,
    name: "Phase10 Promo",
    type: "fixed",
    fixedAmountToman: 1000,
    announce: true,
    isActive: true,
  });
  const customerNotes = await listMyNotifications(customer, 50);
  assert(
    customerNotes.some((n) => n.type === "discount" && n.title.includes("PH10_")),
    "discount announce missing for customer",
  );
  const note = customerNotes.find((n) => n.type === "discount")!;
  await markNotificationRead(customer, note.id);
  const afterRead = await db.query.notifications.findFirst({
    where: eq(notifications.id, note.id),
  });
  assert(afterRead?.readAt, "notification not marked read");
  await markAllNotificationsRead(customer);

  const product = await createProduct(admin, {
    categorySlug: "gift-cards-premium",
    title: "Admin Review Card",
    slug: `admin-rev-${suffix}`,
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
    name: "Std",
    priceToman: 10_000,
    capacityMode: "unlimited",
  });

  const completedId = newId();
  await db.insert(orders).values({
    id: completedId,
    userId: customer.id,
    status: ORDER_STATUSES.completed,
    currencyCode: "IRT",
    subtotalToman: 10_000,
    feeToman: 0,
    fixedCostToman: 0,
    discountToman: 0,
    payableToman: 10_000,
    pricingSnapshot: { test: true },
    paymentExpiresAt: null,
  });
  await db.insert(orderItems).values({
    id: newId(),
    orderId: completedId,
    productId: product.id,
    variantId: variant.id,
    productTitleSnap: "Admin Review Card",
    variantNameSnap: "Std",
    quantity: 1,
    unitPriceToman: 10_000,
    lineTotalToman: 10_000,
  });

  const unpaidId = newId();
  await db.insert(orders).values({
    id: unpaidId,
    userId: customer.id,
    status: ORDER_STATUSES.awaitingPayment,
    currencyCode: "IRT",
    subtotalToman: 10_000,
    feeToman: 0,
    fixedCostToman: 0,
    discountToman: 0,
    payableToman: 10_000,
    pricingSnapshot: { test: true },
    paymentExpiresAt: new Date(Date.now() + 60_000),
  });
  await db.insert(orderItems).values({
    id: newId(),
    orderId: unpaidId,
    productId: product.id,
    variantId: variant.id,
    productTitleSnap: "Admin Review Card",
    variantNameSnap: "Std",
    quantity: 1,
    unitPriceToman: 10_000,
    lineTotalToman: 10_000,
  });

  let unpaidBlocked = false;
  try {
    await createReview(customer, {
      orderId: unpaidId,
      productId: product.id,
      rating: 4,
    });
  } catch (error) {
    unpaidBlocked = error instanceof ValidationError;
  }
  assert(unpaidBlocked, "non-completed order review must fail");

  let missingBlocked = false;
  try {
    await createReview(customer, {
      orderId: newId(),
      productId: product.id,
      rating: 5,
    });
  } catch (error) {
    missingBlocked = error instanceof NotFoundError;
  }
  assert(missingBlocked, "missing order review must fail");

  const review = await createReview(customer, {
    orderId: completedId,
    productId: product.id,
    rating: 5,
    title: "Great",
    body: "Delivered",
  });
  assert(review.moderation === "pending", "new review pending");

  const pending = await listPendingReviews(admin);
  assert(
    pending.some((r) => r.id === review.id),
    "pending list missing review",
  );

  const beforeAvg = await getProductAverageRating(product.id);
  const approvedBefore = beforeAvg.approvedCount;

  await moderateReview(admin, review.id, { moderation: "approved" });
  const afterAvg = await getProductAverageRating(product.id);
  assert(afterAvg.approvedCount === approvedBefore + 1, "approved count");
  assert(afterAvg.averageRating !== null, "approved average");

  await moderateReview(admin, review.id, { moderation: "rejected" });
  const rejectedAvg = await getProductAverageRating(product.id);
  assert(rejectedAvg.approvedCount === approvedBefore, "rejected excluded from average");

  // Sanity: seeded product variants still queryable
  const anyVariant = await db.query.productVariants.findFirst({
    where: isNull(productVariants.deletedAt),
  });
  assert(anyVariant, "variants exist");

  console.log(JSON.stringify({ ok: true, suite: "test-admin" }));
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
