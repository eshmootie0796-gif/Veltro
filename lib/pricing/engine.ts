import { z } from "zod";
import { AppError, ValidationError } from "../errors";
import { parseOrThrow, zCryptoAmount, zNonEmpty } from "../validation/zod";
import { add, applyBps, d, multiply, toTomanInt } from "../money/decimal";
import {
  PRICING_QUOTE_TTL_MS,
  PROVIDER_KEYS,
  QUOTE_CURRENCY,
} from "./constants";
import { assertOrderPricingAvailable } from "./availability";
import { getUsableRate } from "./rate-store";

export type PricingSnapshot = {
  originalCurrency: string;
  originalAmount: string;
  exchangeRate: string;
  exchangeProvider: string;
  exchangeRetrievedAt: string;
  marketPrice: string | null;
  marketProvider: string | null;
  marketRetrievedAt: string | null;
  percentageFeeBps: number;
  percentageFeeToman: number;
  fixedAncillaryCostToman: number;
  shippingToman: number;
  taxToman: number;
  customsToman: number;
  discountToman: number;
  baseToman: number;
  finalToman: number;
  pricingTimestamp: string;
  pricingValidUntil: string;
  categorySlug: string;
  breakdown: Record<string, unknown>;
};

const fxQuoteSchema = z.object({
  categorySlug: zNonEmpty,
  foreignAmount: zCryptoAmount,
  foreignCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .min(3)
    .max(10),
  serviceFeeBps: z.number().int().min(0).max(10000).default(0),
  fixedAncillaryCostToman: z.number().int().nonnegative().default(0),
  discountToman: z.number().int().nonnegative().default(0),
  allowedCurrencies: z.array(z.string().toUpperCase()).optional(),
  /** International shopping extras (foreign currency, converted with same FX rate). */
  shippingForeign: zCryptoAmount.optional(),
  taxForeign: zCryptoAmount.optional(),
  customsForeign: zCryptoAmount.optional(),
});

const cryptoQuoteSchema = z.object({
  categorySlug: zNonEmpty,
  cryptoAmount: zCryptoAmount,
  cryptoSymbol: z.string().trim().toUpperCase().min(2).max(16),
  serviceFeeBps: z.number().int().min(0).max(10000).default(0),
  fixedAncillaryCostToman: z.number().int().nonnegative().default(0),
  discountToman: z.number().int().nonnegative().default(0),
  allowedAssets: z.array(z.string().toUpperCase()).optional(),
});

function validityWindow(from = new Date()) {
  return {
    pricingTimestamp: from.toISOString(),
    pricingValidUntil: new Date(from.getTime() + PRICING_QUOTE_TTL_MS).toISOString(),
  };
}

/**
 * FX-based quote: baseToman = foreign × rate; final = base + fee + fixed − discount.
 * Never accepts client-provided rates.
 */
export async function quoteFxPrice(raw: unknown): Promise<PricingSnapshot> {
  const input = parseOrThrow(fxQuoteSchema, raw);
  await assertOrderPricingAvailable(input.categorySlug);

  if (input.allowedCurrencies && input.allowedCurrencies.length > 0) {
    if (!input.allowedCurrencies.map((c) => c.toUpperCase()).includes(input.foreignCurrency)) {
      throw new ValidationError("Currency not allowed for this service");
    }
  }

  if (input.foreignCurrency === QUOTE_CURRENCY) {
    throw new ValidationError("Foreign currency quote required; IRT uses fixed pricing path");
  }
  if (!d(input.foreignAmount).gt(0)) {
    throw new ValidationError("Foreign amount must be greater than zero");
  }

  const fx = await getUsableRate(
    PROVIDER_KEYS.exchangeRate,
    input.foreignCurrency,
    QUOTE_CURRENCY,
  );

  const productBase = multiply(input.foreignAmount, fx.rate);
  const shipping = multiply(input.shippingForeign ?? "0", fx.rate);
  const tax = multiply(input.taxForeign ?? "0", fx.rate);
  const customs = multiply(input.customsForeign ?? "0", fx.rate);

  const convertedFixed = add(shipping, tax, customs);
  const baseBeforeFee = add(productBase, convertedFixed);
  const fee = applyBps(baseBeforeFee, input.serviceFeeBps);
  const fixedAdmin = d(input.fixedAncillaryCostToman);
  const gross = add(baseBeforeFee, fee, fixedAdmin);
  const discount = d(input.discountToman);
  if (discount.gt(gross)) {
    throw new ValidationError("Discount exceeds payable amount");
  }
  const finalDec = gross.sub(discount);
  const finalToman = toTomanInt(finalDec);
  if (finalToman < 1) {
    throw new ValidationError("Quoted amount rounds to less than 1 Toman");
  }

  const now = new Date();
  const window = validityWindow(now);

  return {
    originalCurrency: input.foreignCurrency,
    originalAmount: input.foreignAmount,
    exchangeRate: fx.rate,
    exchangeProvider: fx.providerName,
    exchangeRetrievedAt: fx.retrievedAt.toISOString(),
    marketPrice: null,
    marketProvider: null,
    marketRetrievedAt: null,
    percentageFeeBps: input.serviceFeeBps,
    percentageFeeToman: toTomanInt(fee),
    fixedAncillaryCostToman: input.fixedAncillaryCostToman,
    shippingToman: toTomanInt(shipping),
    taxToman: toTomanInt(tax),
    customsToman: toTomanInt(customs),
    discountToman: input.discountToman,
    baseToman: toTomanInt(baseBeforeFee),
    finalToman,
    pricingTimestamp: window.pricingTimestamp,
    pricingValidUntil: window.pricingValidUntil,
    categorySlug: input.categorySlug,
    breakdown: {
      formula: "base = foreign*rate; final = base + fee + fixedAdmin + shipping/tax/customs - discount",
      productBaseToman: toTomanInt(productBase),
      convertedFixedToman: toTomanInt(convertedFixed),
    },
  };
}

/**
 * Crypto quote: cryptoAmount × (crypto/USD) × (USD/IRT).
 */
export async function quoteCryptoPrice(raw: unknown): Promise<PricingSnapshot> {
  const input = parseOrThrow(cryptoQuoteSchema, raw);
  await assertOrderPricingAvailable(input.categorySlug);

  if (input.allowedAssets && input.allowedAssets.length > 0) {
    if (!input.allowedAssets.map((a) => a.toUpperCase()).includes(input.cryptoSymbol)) {
      throw new ValidationError("Asset not allowed for this service");
    }
  }

  if (!d(input.cryptoAmount).gt(0)) {
    throw new ValidationError("Crypto amount must be greater than zero");
  }

  const market = await getUsableRate(PROVIDER_KEYS.cryptoPrice, input.cryptoSymbol, "USD");
  const fx = await getUsableRate(PROVIDER_KEYS.exchangeRate, "USD", QUOTE_CURRENCY);

  const usdValue = multiply(input.cryptoAmount, market.rate);
  const base = multiply(usdValue, fx.rate);
  const fee = applyBps(base, input.serviceFeeBps);
  const gross = add(base, fee, input.fixedAncillaryCostToman);
  const discount = d(input.discountToman);
  if (discount.gt(gross)) {
    throw new ValidationError("Discount exceeds payable amount");
  }
  const finalDec = gross.sub(discount);
  const finalToman = toTomanInt(finalDec);
  if (finalToman < 1) {
    throw new ValidationError("Quoted amount rounds to less than 1 Toman");
  }

  const window = validityWindow();

  return {
    originalCurrency: input.cryptoSymbol,
    originalAmount: input.cryptoAmount,
    exchangeRate: fx.rate,
    exchangeProvider: fx.providerName,
    exchangeRetrievedAt: fx.retrievedAt.toISOString(),
    marketPrice: market.rate,
    marketProvider: market.providerName,
    marketRetrievedAt: market.retrievedAt.toISOString(),
    percentageFeeBps: input.serviceFeeBps,
    percentageFeeToman: toTomanInt(fee),
    fixedAncillaryCostToman: input.fixedAncillaryCostToman,
    shippingToman: 0,
    taxToman: 0,
    customsToman: 0,
    discountToman: input.discountToman,
    baseToman: toTomanInt(base),
    finalToman,
    pricingTimestamp: window.pricingTimestamp,
    pricingValidUntil: window.pricingValidUntil,
    categorySlug: input.categorySlug,
    breakdown: {
      formula: "final = crypto*usdMarket*usdIrt + fee + fixed - discount",
      usdValue: usdValue.toString(),
    },
  };
}

/** Fixed IRT catalog pricing (AI / hotels) — no market APIs required. */
export function quoteFixedTomanPrice(input: {
  categorySlug: string;
  unitPriceToman: number;
  quantity?: number;
  serviceFeeBps?: number;
  fixedAncillaryCostToman?: number;
  discountToman?: number;
}): PricingSnapshot {
  if (!Number.isInteger(input.unitPriceToman) || input.unitPriceToman < 0) {
    throw new ValidationError("Invalid unit price");
  }
  const qty = input.quantity ?? 1;
  if (!Number.isInteger(qty) || qty < 1) throw new ValidationError("Invalid quantity");

  const base = d(input.unitPriceToman).mul(qty);
  const fee = applyBps(base, input.serviceFeeBps ?? 0);
  const gross = add(base, fee, input.fixedAncillaryCostToman ?? 0);
  const discount = d(input.discountToman ?? 0);
  if (discount.gt(gross)) throw new ValidationError("Discount exceeds payable amount");
  const window = validityWindow();

  return {
    originalCurrency: QUOTE_CURRENCY,
    originalAmount: String(input.unitPriceToman * qty),
    exchangeRate: "1",
    exchangeProvider: "fixed_irt",
    exchangeRetrievedAt: window.pricingTimestamp,
    marketPrice: null,
    marketProvider: null,
    marketRetrievedAt: null,
    percentageFeeBps: input.serviceFeeBps ?? 0,
    percentageFeeToman: toTomanInt(fee),
    fixedAncillaryCostToman: input.fixedAncillaryCostToman ?? 0,
    shippingToman: 0,
    taxToman: 0,
    customsToman: 0,
    discountToman: input.discountToman ?? 0,
    baseToman: toTomanInt(base),
    finalToman: toTomanInt(gross.sub(discount)),
    pricingTimestamp: window.pricingTimestamp,
    pricingValidUntil: window.pricingValidUntil,
    categorySlug: input.categorySlug,
    breakdown: { formula: "fixed IRT" },
  };
}

export function assertSnapshotStillValid(snapshot: PricingSnapshot, now = new Date()) {
  if (new Date(snapshot.pricingValidUntil).getTime() < now.getTime()) {
    throw new AppError("PRICE_EXPIRED", "Pricing quote expired; request a new quote", 409);
  }
}
