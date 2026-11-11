import { eq } from "drizzle-orm";
import { seedBaseline } from "../lib/db/seeds/run";
import { db } from "../lib/db";
import {
  cryptoReserves,
  cryptoWallets,
  currencies,
  fiatWallets,
  platformFiatTreasury,
  roles,
  users,
} from "../lib/db/schema";
import { newId } from "../lib/ids";
import { hashPassword } from "../lib/auth/password";
import type { AuthUser } from "../lib/auth/rbac";
import { refreshMarketRates } from "../lib/pricing/refresh";
import type { RateProvider } from "../lib/pricing/providers/types";
import {
  buyCrypto,
  convertCrypto,
  previewBuyQuote,
  sellCrypto,
} from "../lib/services/crypto/trading";
import { getCryptoWallet } from "../lib/services/crypto/wallet";
import {
  adminIncreaseReserve,
  assertAdminCryptoBalanceMutationForbidden,
} from "../lib/services/crypto/reserve";
import { getWallet } from "../lib/services/wallet/service";
import { ForbiddenError, InsufficientFundsError } from "../lib/errors";
import { d } from "../lib/money/decimal";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
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
    return bases.map((base) => {
      const code = base.toUpperCase();
      const rate =
        code === "BTC" ? "65000" : code === "ETH" ? "3500" : code === "USDT" ? "1" : "1";
      return {
        baseCode: code,
        quoteCode: quote.toUpperCase(),
        rate,
        marketTimestamp: new Date(),
        providerName: "mock_crypto",
      };
    });
  },
};

async function makeUser(roleSlug: "customer" | "admin"): Promise<AuthUser> {
  const role = await db.query.roles.findFirst({ where: eq(roles.slug, roleSlug) });
  assert(role, `${roleSlug} role missing`);
  const id = newId();
  const suffix = id.slice(0, 8);
  await db.insert(users).values({
    id,
    username: `${roleSlug}_${suffix}`,
    email: `${roleSlug}_${suffix}@test.local`,
    firstName: "Cry",
    lastName: "Pto",
    name: "Cry Pto",
    passwordHash: await hashPassword("TestPass123!"),
    roleId: role.id,
    status: "active",
    emailVerified: new Date(),
  });
  await db.insert(fiatWallets).values({ id: newId(), userId: id, balanceToman: 0 });
  await db.insert(cryptoWallets).values({ id: newId(), userId: id });
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
  await refreshMarketRates({
    fxProvider: mockFx,
    cryptoProvider: mockCrypto,
    fxBases: ["USD"],
    cryptoBases: ["BTC", "ETH", "USDT"],
  });

  const admin = await makeUser("admin");
  const customer = await makeUser("customer");

  // Fund Toman wallet (direct credit — above mock top-up max)
  await db
    .update(fiatWallets)
    .set({ balanceToman: 50_000_000_000, updatedAt: new Date() })
    .where(eq(fiatWallets.userId, customer.id));

  await adminIncreaseReserve(admin, {
    currencyCode: "BTC",
    amount: "1",
    reason: "crypto suite reserve",
  });

  const quote = await previewBuyQuote("BTC", "0.01");
  // 0.01 * 65000 * 60000 = 39_000_000 base; fee 1% = 390_000; payable 39_390_000
  assert(quote.baseToman === 39_000_000, `base ${quote.baseToman}`);
  assert(quote.payableToman === 39_390_000, `payable ${quote.payableToman}`);

  const buyKey = `buy_${newId().slice(0, 12)}`;
  const bought = await buyCrypto(customer, {
    currencyCode: "BTC",
    amount: "0.01",
    idempotencyKey: buyKey,
  });
  assert(bought.side === "buy", "buy side");
  assert(bought.idempotentReplay === false, "first buy");

  const replay = await buyCrypto(customer, {
    currencyCode: "BTC",
    amount: "0.01",
    idempotencyKey: buyKey,
  });
  assert(replay.idempotentReplay === true, "idempotent buy");
  assert(replay.id === bought.id, "same trade id");

  const wallet = await getCryptoWallet(customer);
  const btc = wallet.balances.find((b) => b.currencyCode === "BTC");
  assert(btc && d(btc.balance).eq("0.01"), `btc bal ${btc?.balance}`);

  const fiatAfterBuy = await getWallet(customer);
  assert(fiatAfterBuy.balanceToman === 50_000_000_000 - 39_390_000, "toman debited");

  // Sell
  const sellKey = `sell_${newId().slice(0, 12)}`;
  const sold = await sellCrypto(customer, {
    currencyCode: "BTC",
    amount: "0.005",
    idempotencyKey: sellKey,
  });
  assert(sold.side === "sell", "sell side");
  // base 0.005*65000*60000=19_500_000; fee 195_000; payout 19_305_000
  assert(sold.payableOrPayoutToman === 19_305_000, `payout ${sold.payableOrPayoutToman}`);

  const walletAfterSell = await getCryptoWallet(customer);
  const btcAfter = walletAfterSell.balances.find((b) => b.currencyCode === "BTC");
  assert(btcAfter && d(btcAfter.balance).eq("0.005"), `btc after sell ${btcAfter?.balance}`);

  // Convert BTC → ETH (destination must come from platform reserve)
  await adminIncreaseReserve(admin, {
    currencyCode: "ETH",
    amount: "100",
    reason: "convert test reserve",
  });
  const convertKey = `cv_${newId().slice(0, 12)}`;
  const converted = await convertCrypto(customer, {
    sourceCurrencyCode: "BTC",
    destinationCurrencyCode: "ETH",
    amount: "0.001",
    idempotencyKey: convertKey,
  });
  assert(converted.side === "convert", "convert side");
  assert(d(converted.destinationAmount).gt(0), "got eth");

  // Insufficient crypto
  let insufCrypto = false;
  try {
    await sellCrypto(customer, {
      currencyCode: "BTC",
      amount: "100",
      idempotencyKey: `bad_${newId().slice(0, 8)}`,
    });
  } catch (error) {
    insufCrypto = error instanceof InsufficientFundsError;
  }
  assert(insufCrypto, "reject oversell");

  // Insufficient toman for buy
  await db
    .update(fiatWallets)
    .set({ balanceToman: 100, updatedAt: new Date() })
    .where(eq(fiatWallets.userId, customer.id));
  let insufFiat = false;
  try {
    await buyCrypto(customer, {
      currencyCode: "ETH",
      amount: "1",
      idempotencyKey: `nofiat_${newId().slice(0, 8)}`,
    });
  } catch (error) {
    insufFiat = error instanceof InsufficientFundsError;
  }
  assert(insufFiat, "reject buy without toman");

  // Insufficient reserve
  const ethCurrency = await db.query.currencies.findFirst({
    where: eq(currencies.code, "ETH"),
  });
  assert(ethCurrency, "eth currency");
  const ethReserve = await db.query.cryptoReserves.findFirst({
    where: eq(cryptoReserves.currencyId, ethCurrency.id),
  });
  assert(ethReserve, "eth reserve");
  await db
    .update(cryptoReserves)
    .set({ balance: "0", updatedAt: new Date() })
    .where(eq(cryptoReserves.id, ethReserve.id));
  await db
    .update(fiatWallets)
    .set({ balanceToman: 100_000_000_000, updatedAt: new Date() })
    .where(eq(fiatWallets.userId, customer.id));
  let insufReserve = false;
  try {
    await buyCrypto(customer, {
      currencyCode: "ETH",
      amount: "1",
      idempotencyKey: `nores_${newId().slice(0, 8)}`,
    });
  } catch (error) {
    insufReserve = error instanceof InsufficientFundsError;
  }
  assert(insufReserve, "reject buy without reserve");

  // Admin increase reserve
  const increased = await adminIncreaseReserve(admin, {
    currencyCode: "ETH",
    amount: "50",
    reason: "Seed liquidity",
  });
  assert(d(increased.balanceAfter).gte(50), "reserve increased");

  // Insufficient system Toman liquidity
  await db
    .update(platformFiatTreasury)
    .set({ balanceToman: 0, updatedAt: new Date() })
    .where(eq(platformFiatTreasury.currencyCode, "IRT"));
  // Give customer some BTC via reserve restore + buy path skipped; credit via admin reserve + buy USDT small
  // Direct: buy USDT after restoring treasury temporarily then drain — simpler set customer BTC and try sell
  await adminIncreaseReserve(admin, {
    currencyCode: "BTC",
    amount: "1",
    reason: "test",
  });
  // Restore customer BTC by buying after funding treasury from a buy that credits treasury
  await db
    .update(platformFiatTreasury)
    .set({ balanceToman: 1, updatedAt: new Date() })
    .where(eq(platformFiatTreasury.currencyCode, "IRT"));

  // Customer still has some BTC from earlier (~0.004 after convert)
  let insufTreasury = false;
  try {
    await sellCrypto(customer, {
      currencyCode: "BTC",
      amount: "0.001",
      idempotencyKey: `notoman_${newId().slice(0, 8)}`,
    });
  } catch (error) {
    insufTreasury = error instanceof InsufficientFundsError;
  }
  assert(insufTreasury, "reject sell without system toman");

  // Admin cannot decrease / mutate customer crypto via guard
  let blocked = false;
  try {
    assertAdminCryptoBalanceMutationForbidden();
  } catch (error) {
    blocked = error instanceof ForbiddenError;
  }
  assert(blocked, "admin crypto mutation forbidden");

  // Concurrent buys against limited reserve
  await adminIncreaseReserve(admin, {
    currencyCode: "USDT",
    amount: "3",
    reason: "race pool",
  });
  // Cap USDT reserve to 3
  const usdt = await db.query.currencies.findFirst({ where: eq(currencies.code, "USDT") });
  assert(usdt, "usdt");
  const usdtReserve = await db.query.cryptoReserves.findFirst({
    where: eq(cryptoReserves.currencyId, usdt.id),
  });
  assert(usdtReserve, "usdt reserve");
  await db
    .update(cryptoReserves)
    .set({ balance: "3", updatedAt: new Date() })
    .where(eq(cryptoReserves.id, usdtReserve.id));
  await db
    .update(platformFiatTreasury)
    .set({ balanceToman: 5_000_000_000, updatedAt: new Date() })
    .where(eq(platformFiatTreasury.currencyCode, "IRT"));

  const racers = await Promise.all(Array.from({ length: 6 }, () => makeUser("customer")));
  for (const r of racers) {
    await db
      .update(fiatWallets)
      .set({ balanceToman: 10_000_000_000, updatedAt: new Date() })
      .where(eq(fiatWallets.userId, r.id));
  }
  const race = await Promise.allSettled(
    racers.map((r, i) =>
      buyCrypto(r, {
        currencyCode: "USDT",
        amount: "1",
        idempotencyKey: `race_${i}_${newId().slice(0, 8)}`,
      }),
    ),
  );
  const wins = race.filter((r) => r.status === "fulfilled").length;
  assert(wins === 3, `usdt race wins=${wins}`);

  console.log(
    JSON.stringify({
      ok: true,
      suite: "test-crypto",
      buyPayable: bought.payableOrPayoutToman,
      sellPayout: sold.payableOrPayoutToman,
      convertDest: converted.destinationAmount,
      raceWins: wins,
    }),
  );
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
