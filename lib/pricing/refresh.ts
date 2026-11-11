import { eq } from "drizzle-orm";
import { db } from "../db";
import { backgroundJobs, currencies } from "../db/schema";
import { newId } from "../ids";
import { logger } from "../logger";
import { PROVIDER_KEYS, QUOTE_CURRENCY } from "./constants";
import { createFxProvider } from "./providers/fx-provider";
import { createCryptoProvider } from "./providers/crypto-provider";
import type { RateProvider } from "./providers/types";
import {
  ensureProviderRows,
  markProviderUnavailable,
  upsertValidRates,
} from "./rate-store";

export type RefreshDeps = {
  fxProvider?: RateProvider;
  cryptoProvider?: RateProvider;
  fxBases?: string[];
  cryptoBases?: string[];
};

async function activeCodes(kind: "fiat" | "crypto") {
  const rows = await db.query.currencies.findMany({
    where: eq(currencies.kind, kind),
  });
  return rows.filter((c) => c.isActive && c.code !== QUOTE_CURRENCY).map((c) => c.code);
}

/**
 * Fetch FX + crypto rates from the single configured providers.
 * On failure: mark unavailable (do not keep using last rate).
 */
export async function refreshMarketRates(deps: RefreshDeps = {}) {
  await ensureProviderRows();

  const jobId = newId();
  await db.insert(backgroundJobs).values({
    id: jobId,
    type: "refresh_market_rates",
    status: "running",
    startedAt: new Date(),
    payload: {},
  });

  const fxProvider = deps.fxProvider ?? createFxProvider();
  const cryptoProvider = deps.cryptoProvider ?? createCryptoProvider();
  const fxBases = deps.fxBases ?? (await activeCodes("fiat"));
  const cryptoBases = deps.cryptoBases ?? (await activeCodes("crypto"));

  const result: Record<string, unknown> = { fx: null, crypto: null };

  // FX
  if (fxBases.length > 0) {
    const pairs = fxBases.map((b) => ({ baseCode: b, quoteCode: QUOTE_CURRENCY }));
    try {
      const rates = await fxProvider.fetchRates(fxBases, QUOTE_CURRENCY);
      await upsertValidRates(PROVIDER_KEYS.exchangeRate, rates, pairs);
      result.fx = { ok: true, count: rates.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : "FX refresh failed";
      await markProviderUnavailable(
        PROVIDER_KEYS.exchangeRate,
        fxProvider.name,
        message,
        pairs,
      );
      result.fx = { ok: false, error: message };
      logger.warn("fx_refresh_failed", { message });
    }
  }

  // Crypto market prices quoted in USD then convertible via FX — store crypto/USD feeds.
  // Pricing engine multiplies crypto→USD * USD→IRT when quoting IRT.
  if (cryptoBases.length > 0) {
    const quote = "USD";
    const pairs = cryptoBases.map((b) => ({ baseCode: b, quoteCode: quote }));
    try {
      const rates = await cryptoProvider.fetchRates(cryptoBases, quote);
      await upsertValidRates(PROVIDER_KEYS.cryptoPrice, rates, pairs);
      result.crypto = { ok: true, count: rates.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Crypto refresh failed";
      await markProviderUnavailable(
        PROVIDER_KEYS.cryptoPrice,
        cryptoProvider.name,
        message,
        pairs,
      );
      result.crypto = { ok: false, error: message };
      logger.warn("crypto_refresh_failed", { message });
    }
  }

  await db
    .update(backgroundJobs)
    .set({
      status: "succeeded",
      result,
      finishedAt: new Date(),
    })
    .where(eq(backgroundJobs.id, jobId));

  return { jobId, result };
}
