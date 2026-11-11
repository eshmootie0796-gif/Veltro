import { seedBaseline } from "../lib/db/seeds/run";
import { refreshMarketRates } from "../lib/pricing/refresh";
import {
  assertSnapshotStillValid,
  quoteCryptoPrice,
  quoteFixedTomanPrice,
  quoteFxPrice,
} from "../lib/pricing/engine";
import { assertOrderPricingAvailable, getPricingAvailability } from "../lib/pricing/availability";
import { normalizeFxPayload } from "../lib/pricing/providers/fx-provider";
import { normalizeCryptoPayload } from "../lib/pricing/providers/crypto-provider";
import type { RateProvider } from "../lib/pricing/providers/types";
import { AppError } from "../lib/errors";
import { toTomanInt, applyBps } from "../lib/money/decimal";

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
      rate: base.toUpperCase() === "USD" ? "60000" : base.toUpperCase() === "EUR" ? "65000" : "1",
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

const failingFx: RateProvider = {
  key: "exchange_rate",
  name: "fail_fx",
  async fetchRates() {
    throw new Error("FX down");
  },
};

async function main() {
  await seedBaseline();

  // Decimal helpers
  assert(toTomanInt("123.4") === 123, "round half-up down");
  assert(toTomanInt("123.5") === 124, "round half-up up");
  assert(applyBps("100000", 250).toString() === "2500", "2.5% fee");

  // Payload normalizers
  const fxRows = normalizeFxPayload(
    { rates: { USD: "60000" }, provider: "x" },
    ["USD"],
    "IRT",
    "x",
  );
  assert(fxRows[0]?.rate === "60000", "fx normalize");

  const cryptoRows = normalizeCryptoPayload(
    { prices: [{ symbol: "BTC", price: "65000", quote: "USD" }] },
    ["BTC"],
    "USD",
    "y",
  );
  assert(cryptoRows[0]?.rate === "65000", "crypto normalize");

  // Refresh success
  await refreshMarketRates({
    fxProvider: mockFx,
    cryptoProvider: mockCrypto,
    fxBases: ["USD", "EUR"],
    cryptoBases: ["BTC", "ETH"],
  });

  const availability = await getPricingAvailability();
  assert(availability.exchangeRate.healthy, "fx healthy");
  assert(availability.cryptoPrice.healthy, "crypto healthy");

  await assertOrderPricingAvailable("paypal-services");

  const fxQuote = await quoteFxPrice({
    categorySlug: "paypal-services",
    foreignAmount: "100",
    foreignCurrency: "USD",
    serviceFeeBps: 200,
    fixedAncillaryCostToman: 1000,
  });
  // base 100*60000=6_000_000; fee 2%=120_000; fixed 1000; final 6_121_000
  assert(fxQuote.baseToman === 6_000_000, `base ${fxQuote.baseToman}`);
  assert(fxQuote.percentageFeeToman === 120_000, `fee ${fxQuote.percentageFeeToman}`);
  assert(fxQuote.finalToman === 6_121_000, `final ${fxQuote.finalToman}`);
  assertSnapshotStillValid(fxQuote);

  const shopping = await quoteFxPrice({
    categorySlug: "international-shopping",
    foreignAmount: "50",
    foreignCurrency: "USD",
    serviceFeeBps: 100,
    shippingForeign: "10",
    taxForeign: "5",
    customsForeign: "5",
  });
  // product 50*60000=3e6; ship/tax/customs 20*60000=1.2e6; base 4.2e6; fee 1%=42000
  assert(shopping.baseToman === 4_200_000, `shop base ${shopping.baseToman}`);
  assert(shopping.shippingToman === 600_000, "shipping");
  assert(shopping.finalToman === 4_242_000, `shop final ${shopping.finalToman}`);

  const cryptoQuote = await quoteCryptoPrice({
    categorySlug: "cryptocurrency",
    cryptoAmount: "0.01",
    cryptoSymbol: "BTC",
    serviceFeeBps: 0,
  });
  // 0.01 * 65000 USD * 60000 IRT = 39_000_000
  assert(cryptoQuote.finalToman === 39_000_000, `crypto ${cryptoQuote.finalToman}`);
  assert(Number(cryptoQuote.marketPrice) === 65000, "market snapshot");

  const fixed = quoteFixedTomanPrice({
    categorySlug: "ai-subscriptions",
    unitPriceToman: 500_000,
    serviceFeeBps: 0,
  });
  assert(fixed.finalToman === 500_000, "fixed irt");

  // Failure path: mark unavailable, refuse order creation, no stale reuse
  await refreshMarketRates({
    fxProvider: failingFx,
    cryptoProvider: mockCrypto,
    fxBases: ["USD"],
    cryptoBases: ["BTC"],
  });

  const down = await getPricingAvailability();
  assert(!down.exchangeRate.healthy, "fx marked unhealthy");

  let blocked = false;
  try {
    await assertOrderPricingAvailable("visa-mastercard");
  } catch (error) {
    blocked = error instanceof AppError && error.code === "FX_UNAVAILABLE";
  }
  assert(blocked, "order creation must block when FX down");

  let quoteBlocked = false;
  try {
    await quoteFxPrice({
      categorySlug: "gift-cards-premium",
      foreignAmount: "10",
      foreignCurrency: "USD",
    });
  } catch (error) {
    quoteBlocked = error instanceof AppError;
  }
  assert(quoteBlocked, "quote must refuse unavailable rates");

  // Restore for cleanliness
  await refreshMarketRates({
    fxProvider: mockFx,
    cryptoProvider: mockCrypto,
    fxBases: ["USD", "EUR"],
    cryptoBases: ["BTC", "ETH"],
  });

  console.log(JSON.stringify({ ok: true, suite: "test-pricing" }));
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
