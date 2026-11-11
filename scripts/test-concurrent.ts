import { eq } from "drizzle-orm";
import { seedBaseline } from "../lib/db/seeds/run";
import { db } from "../lib/db";
import {
  cryptoReserves,
  cryptoWallets,
  currencies,
  discounts,
  fiatWallets,
  platformFiatTreasury,
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
import { payOrder } from "../lib/services/payments/service";
import { mockWalletTopup } from "../lib/services/wallet/service";
import { refreshMarketRates } from "../lib/pricing/refresh";
import type { RateProvider } from "../lib/pricing/providers/types";
import { buyCrypto } from "../lib/services/crypto/trading";
import { adminIncreaseReserve } from "../lib/services/crypto/reserve";
import { CapacityExceededError, InsufficientFundsError } from "../lib/errors";
import { PAYMENT_METHODS } from "../lib/payments/constants";
import { d } from "../lib/money/decimal";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function makeCustomer(): Promise<AuthUser> {
  const role = await db.query.roles.findFirst({ where: eq(roles.slug, "customer") });
  assert(role, "customer role missing");
  const id = newId();
  const suffix = id.slice(0, 8);
  await db.insert(users).values({
    id,
    username: `c_${suffix}`,
    email: `c_${suffix}@test.local`,
    firstName: "C",
    lastName: "User",
    name: "C User",
    passwordHash: await hashPassword("TestPass123!"),
    roleId: role.id,
    status: "active",
    emailVerified: new Date(),
  });
  await db.insert(fiatWallets).values({ id: newId(), userId: id, balanceToman: 0 });
  await db.insert(cryptoWallets).values({ id: newId(), userId: id });
  return {
    id,
    email: `c_${suffix}@test.local`,
    username: `c_${suffix}`,
    role: "customer",
    status: "active",
    emailVerified: new Date(),
    sessionVersion: 0,
  };
}

async function makeAdmin(): Promise<AuthUser> {
  const role = await db.query.roles.findFirst({ where: eq(roles.slug, "admin") });
  assert(role, "admin role missing");
  const id = newId();
  const suffix = id.slice(0, 8);
  await db.insert(users).values({
    id,
    username: `a_${suffix}`,
    email: `a_${suffix}@test.local`,
    firstName: "A",
    lastName: "Admin",
    name: "A Admin",
    passwordHash: await hashPassword("TestPass123!"),
    roleId: role.id,
    status: "active",
    emailVerified: new Date(),
  });
  return {
    id,
    email: `a_${suffix}@test.local`,
    username: `a_${suffix}`,
    role: "admin",
    status: "active",
    emailVerified: new Date(),
    sessionVersion: 0,
  };
}

const mockFx: RateProvider = {
  key: "exchange_rate",
  name: "mock_fx",
  async fetchRates(bases, quote) {
    return bases.map((base) => ({
      baseCode: base.toUpperCase(),
      quoteCode: quote.toUpperCase(),
      rate: base.toUpperCase() === "USD" ? "60000" : "1",
      marketTimestamp: new Date(),
      providerName: "mock_fx",
    }));
  },
};

const mockCrypto: RateProvider = {
  key: "crypto_price",
  name: "mock_crypto",
  async fetchRates(bases, quote) {
    return bases.map((base) => ({
      baseCode: base.toUpperCase(),
      quoteCode: quote.toUpperCase(),
      rate: base.toUpperCase() === "BTC" ? "65000" : "1",
      marketTimestamp: new Date(),
      providerName: "mock_crypto",
    }));
  },
};

async function main() {
  await seedBaseline();
  const admin = await makeAdmin();
  const suffix = newId().slice(0, 6);

  // --- Capacity oversell ---
  const product = await createProduct(admin, {
    categorySlug: "gift-cards-premium",
    title: "Concurrent Cap",
    slug: `conc-cap-${suffix}`,
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
    name: "Cap1",
    priceToman: 10_000,
    capacityMode: "finite",
    capacityTotal: 1,
    capacityRemaining: 1,
  });

  const c1 = await makeCustomer();
  const c2 = await makeCustomer();
  const capacityResults = await Promise.allSettled([
    createOrder(c1, { variantId: variant.id, quantity: 1 }),
    createOrder(c2, { variantId: variant.id, quantity: 1 }),
  ]);
  const capOk = capacityResults.filter((r) => r.status === "fulfilled").length;
  const capFail = capacityResults.filter(
    (r) =>
      r.status === "rejected" &&
      (r.reason instanceof CapacityExceededError ||
        String(r.reason).includes("capacity") ||
        String(r.reason).includes("Capacity")),
  ).length;
  assert(capOk === 1 && capFail === 1, `capacity race: ok=${capOk} fail=${capFail}`);

  // --- Discount usage limit ---
  await createDiscount(admin, {
    code: `ONCE_${suffix.toUpperCase()}`,
    name: "Once",
    type: "fixed",
    fixedAmountToman: 1000,
    usageLimit: 1,
    announce: false,
    isActive: true,
  });
  const unlimited = await createVariant(admin, product.id, {
    name: "Unlim",
    priceToman: 20_000,
    capacityMode: "unlimited",
  });
  const d1 = await makeCustomer();
  const d2 = await makeCustomer();
  const discountResults = await Promise.allSettled([
    createOrder(d1, {
      variantId: unlimited.id,
      quantity: 1,
      discountCode: `ONCE_${suffix.toUpperCase()}`,
    }),
    createOrder(d2, {
      variantId: unlimited.id,
      quantity: 1,
      discountCode: `ONCE_${suffix.toUpperCase()}`,
    }),
  ]);
  const discOk = discountResults.filter((r) => r.status === "fulfilled").length;
  const discFail = discountResults.filter((r) => r.status === "rejected").length;
  assert(discOk === 1 && discFail === 1, `discount race: ok=${discOk} fail=${discFail}`);
  const discRow = await db.query.discounts.findFirst({
    where: eq(discounts.code, `ONCE_${suffix.toUpperCase()}`),
  });
  assert(discRow, "discount missing");

  // --- Wallet double-spend ---
  const wUser = await makeCustomer();
  await db
    .update(fiatWallets)
    .set({ balanceToman: 25_000, updatedAt: new Date() })
    .where(eq(fiatWallets.userId, wUser.id));
  const wOrderA = await createOrder(wUser, { variantId: unlimited.id, quantity: 1 });
  const wOrderB = await createOrder(wUser, { variantId: unlimited.id, quantity: 1 });
  // Each order ~20k; wallet 25k — only one wallet pay can succeed
  const walletPays = await Promise.allSettled([
    payOrder(wUser, wOrderA.id, { method: PAYMENT_METHODS.walletFiat }),
    payOrder(wUser, wOrderB.id, { method: PAYMENT_METHODS.walletFiat }),
  ]);
  const payOk = walletPays.filter((r) => r.status === "fulfilled").length;
  const payFail = walletPays.filter(
    (r) =>
      r.status === "rejected" &&
      (r.reason instanceof InsufficientFundsError ||
        String(r.reason).includes("Insufficient") ||
        String(r.reason).includes("insufficient")),
  ).length;
  assert(payOk === 1 && payFail === 1, `wallet race: ok=${payOk} fail=${payFail}`);
  const wallet = await db.query.fiatWallets.findFirst({
    where: eq(fiatWallets.userId, wUser.id),
  });
  assert(wallet && wallet.balanceToman >= 0, "negative wallet balance");

  // Smoke top-up path still works (limits apply)
  const topupUser = await makeCustomer();
  await mockWalletTopup(topupUser, { amountToman: 50_000, simulate: "success" });

  // --- Crypto reserve race ---
  await refreshMarketRates({ fxProvider: mockFx, cryptoProvider: mockCrypto });
  const btc = await db.query.currencies.findFirst({ where: eq(currencies.code, "BTC") });
  assert(btc, "BTC missing");
  const reserve = await db.query.cryptoReserves.findFirst({
    where: eq(cryptoReserves.currencyId, btc.id),
  });
  assert(reserve, "BTC reserve missing");
  const treasury = await db.query.platformFiatTreasury.findFirst();
  if (treasury) {
    await db
      .update(platformFiatTreasury)
      .set({ balanceToman: 50_000_000_000, updatedAt: new Date() })
      .where(eq(platformFiatTreasury.id, treasury.id));
  }

  const buyer1 = await makeCustomer();
  const buyer2 = await makeCustomer();
  await db
    .update(fiatWallets)
    .set({ balanceToman: 100_000_000_000, updatedAt: new Date() })
    .where(eq(fiatWallets.userId, buyer1.id));
  await db
    .update(fiatWallets)
    .set({ balanceToman: 100_000_000_000, updatedAt: new Date() })
    .where(eq(fiatWallets.userId, buyer2.id));

  await adminIncreaseReserve(admin, {
    currencyCode: "BTC",
    amount: "0.0002",
    reason: "concurrent test seed",
  });

  const afterBump = await db.query.cryptoReserves.findFirst({
    where: eq(cryptoReserves.currencyId, btc.id),
  });
  await db
    .update(cryptoReserves)
    .set({ balance: "0.0001" })
    .where(eq(cryptoReserves.id, afterBump!.id));

  const cryptoResults = await Promise.allSettled([
    buyCrypto(buyer1, {
      currencyCode: "BTC",
      amount: "0.0001",
      idempotencyKey: `buy1_${suffix}`,
    }),
    buyCrypto(buyer2, {
      currencyCode: "BTC",
      amount: "0.0001",
      idempotencyKey: `buy2_${suffix}`,
    }),
  ]);
  const cryptoOk = cryptoResults.filter((r) => r.status === "fulfilled").length;
  const cryptoFail = cryptoResults.filter((r) => r.status === "rejected").length;
  assert(
    cryptoOk === 1 && cryptoFail === 1,
    `crypto reserve race: ok=${cryptoOk} fail=${cryptoFail}`,
  );
  const finalReserve = await db.query.cryptoReserves.findFirst({
    where: eq(cryptoReserves.currencyId, btc.id),
  });
  assert(finalReserve && !d(finalReserve.balance).isNegative(), "negative reserve");

  // Variant remaining never negative
  const vRow = await db.query.productVariants.findFirst({
    where: eq(productVariants.id, variant.id),
  });
  assert(
    vRow && (vRow.capacityRemaining ?? 0) >= 0,
    "capacity remaining negative",
  );

  console.log(
    JSON.stringify({
      ok: true,
      suite: "test-concurrent",
      capacity: { ok: capOk, fail: capFail },
      discount: { ok: discOk, fail: discFail },
      wallet: { ok: payOk, fail: payFail },
      crypto: { ok: cryptoOk, fail: cryptoFail },
    }),
  );
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
