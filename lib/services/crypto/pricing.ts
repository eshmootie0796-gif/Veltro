import { applyBps, d, multiply, toTomanInt } from "../../money/decimal";
import { getUsableRate } from "../../pricing/rate-store";
import { PROVIDER_KEYS, QUOTE_CURRENCY } from "../../pricing/constants";
import { ValidationError } from "../../errors";

export type CryptoMarketQuote = {
  symbol: string;
  amount: string;
  marketUsdRate: string;
  usdIrtRate: string;
  usdValue: string;
  baseToman: number;
  marketProvider: string;
  marketRetrievedAt: string;
  fxProvider: string;
  fxRetrievedAt: string;
};

/**
 * Value crypto amount in integer Toman via crypto/USD × USD/IRT.
 */
export async function quoteCryptoToToman(
  symbol: string,
  amount: string,
): Promise<CryptoMarketQuote> {
  const code = symbol.trim().toUpperCase();
  if (!code) throw new ValidationError("Cryptocurrency symbol required");
  if (d(amount).lte(0)) throw new ValidationError("Amount must be positive");

  const market = await getUsableRate(PROVIDER_KEYS.cryptoPrice, code, "USD");
  const fx = await getUsableRate(PROVIDER_KEYS.exchangeRate, "USD", QUOTE_CURRENCY);
  const usdValue = multiply(amount, market.rate);
  const base = multiply(usdValue, fx.rate);

  return {
    symbol: code,
    amount,
    marketUsdRate: market.rate,
    usdIrtRate: fx.rate,
    usdValue: usdValue.toString(),
    baseToman: toTomanInt(base),
    marketProvider: market.providerName,
    marketRetrievedAt: market.retrievedAt.toISOString(),
    fxProvider: fx.providerName,
    fxRetrievedAt: fx.retrievedAt.toISOString(),
  };
}

export function applyBuyFee(baseToman: number, feeBps: number) {
  const feeToman = toTomanInt(applyBps(baseToman, feeBps));
  return { feeToman, payableToman: baseToman + feeToman };
}

export function applySellFee(baseToman: number, feeBps: number) {
  const feeToman = toTomanInt(applyBps(baseToman, feeBps));
  const payoutToman = baseToman - feeToman;
  if (payoutToman < 0) throw new ValidationError("Fee exceeds sell value");
  return { feeToman, payoutToman };
}

/**
 * Convert source crypto amount → destination crypto amount.
 * Fee deducted from destination: destNet = destGross − bps(destGross).
 */
export async function quoteCryptoConvert(input: {
  sourceSymbol: string;
  destinationSymbol: string;
  sourceAmount: string;
  feeBps: number;
}) {
  const src = input.sourceSymbol.trim().toUpperCase();
  const dst = input.destinationSymbol.trim().toUpperCase();
  if (src === dst) throw new ValidationError("Source and destination must differ");
  if (d(input.sourceAmount).lte(0)) throw new ValidationError("Amount must be positive");

  const srcMarket = await getUsableRate(PROVIDER_KEYS.cryptoPrice, src, "USD");
  const dstMarket = await getUsableRate(PROVIDER_KEYS.cryptoPrice, dst, "USD");

  const usdValue = multiply(input.sourceAmount, srcMarket.rate);
  if (d(dstMarket.rate).lte(0)) throw new ValidationError("Invalid destination market rate");
  const destGross = d(usdValue).div(d(dstMarket.rate));
  const fee = applyBps(destGross, input.feeBps);
  const destNet = destGross.sub(fee);
  if (destNet.lte(0)) throw new ValidationError("Fee exceeds conversion value");

  return {
    sourceSymbol: src,
    destinationSymbol: dst,
    sourceAmount: input.sourceAmount,
    destinationGross: destGross.toFixed(18),
    destinationAmount: destNet.toFixed(18),
    feeAmount: fee.toFixed(18),
    feeBps: input.feeBps,
    usdValue: usdValue.toString(),
    sourceMarketUsdRate: srcMarket.rate,
    destinationMarketUsdRate: dstMarket.rate,
    sourceMarketProvider: srcMarket.providerName,
    destinationMarketProvider: dstMarket.providerName,
    sourceMarketRetrievedAt: srcMarket.retrievedAt.toISOString(),
    destinationMarketRetrievedAt: dstMarket.retrievedAt.toISOString(),
  };
}
