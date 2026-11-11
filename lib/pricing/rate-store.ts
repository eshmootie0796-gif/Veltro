import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { providerStatuses, rateFeedSnapshots, rateFeeds } from "../db/schema";
import { newId } from "../ids";
import { AppError } from "../errors";
import {
  DEFAULT_RATE_MAX_AGE_MS,
  PROVIDER_KEYS,
  QUOTE_CURRENCY,
  RATE_VALIDATION,
  type ProviderKey,
  type RateValidationStatus,
} from "./constants";
import type { FetchedRate } from "./providers/types";
import { d } from "../money/decimal";

export type UsableRate = {
  providerKey: ProviderKey;
  providerName: string;
  baseCode: string;
  quoteCode: string;
  rate: string;
  retrievedAt: Date;
  marketTimestamp: Date | null;
};

function maxAgeMs(): number {
  const raw = process.env.RATE_MAX_AGE_MS;
  if (!raw) return DEFAULT_RATE_MAX_AGE_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RATE_MAX_AGE_MS;
}

export async function markProviderUnavailable(
  providerKey: ProviderKey,
  providerName: string,
  errorMessage: string,
  pairs: Array<{ baseCode: string; quoteCode: string }>,
) {
  const now = new Date();

  await db.transaction(async (tx) => {
    const existing = await tx.query.providerStatuses.findFirst({
      where: eq(providerStatuses.providerKey, providerKey),
    });
    if (existing) {
      await tx
        .update(providerStatuses)
        .set({
          isHealthy: false,
          lastFailureAt: now,
          lastError: errorMessage,
          updatedAt: now,
        })
        .where(eq(providerStatuses.id, existing.id));
    } else {
      await tx.insert(providerStatuses).values({
        id: newId(),
        providerKey,
        providerName,
        isHealthy: false,
        lastFailureAt: now,
        lastError: errorMessage,
      });
    }

    for (const pair of pairs) {
      const feed = await tx.query.rateFeeds.findFirst({
        where: and(
          eq(rateFeeds.providerKey, providerKey),
          eq(rateFeeds.baseCode, pair.baseCode.toUpperCase()),
          eq(rateFeeds.quoteCode, pair.quoteCode.toUpperCase()),
        ),
      });

      if (feed) {
        await tx
          .update(rateFeeds)
          .set({
            validationStatus: RATE_VALIDATION.unavailable,
            lastError: errorMessage,
            updatedAt: now,
            // Keep numeric column but status forbids use — do not trust prior rate.
          })
          .where(eq(rateFeeds.id, feed.id));
      } else {
        await tx.insert(rateFeeds).values({
          id: newId(),
          providerKey,
          providerName,
          baseCode: pair.baseCode.toUpperCase(),
          quoteCode: pair.quoteCode.toUpperCase(),
          rate: "0",
          validationStatus: RATE_VALIDATION.unavailable,
          lastError: errorMessage,
        });
      }

      await tx.insert(rateFeedSnapshots).values({
        id: newId(),
        providerKey,
        providerName,
        baseCode: pair.baseCode.toUpperCase(),
        quoteCode: pair.quoteCode.toUpperCase(),
        rate: "0",
        retrievedAt: now,
        marketTimestamp: null,
        validationStatus: RATE_VALIDATION.unavailable,
        error: errorMessage,
      });
    }
  });
}

export async function upsertValidRates(
  providerKey: ProviderKey,
  rates: FetchedRate[],
  requestedPairs: Array<{ baseCode: string; quoteCode: string }>,
) {
  const now = new Date();
  const ageLimit = maxAgeMs();
  const byPair = new Map(rates.map((r) => [`${r.baseCode}:${r.quoteCode}`, r]));

  await db.transaction(async (tx) => {
    let anyValid = false;

    for (const pair of requestedPairs) {
      const key = `${pair.baseCode.toUpperCase()}:${pair.quoteCode.toUpperCase()}`;
      const fetched = byPair.get(key);
      let status: RateValidationStatus = RATE_VALIDATION.unavailable;
      let rate = "0";
      let marketTimestamp: Date | null = null;
      let error: string | null = "Rate missing from provider response";
      let providerName = rates[0]?.providerName ?? providerKey;

      if (fetched) {
        providerName = fetched.providerName;
        try {
          const dec = d(fetched.rate);
          if (!dec.isFinite() || dec.lte(0)) {
            status = RATE_VALIDATION.invalid;
            error = "Non-positive rate";
          } else if (
            fetched.marketTimestamp &&
            now.getTime() - fetched.marketTimestamp.getTime() > ageLimit
          ) {
            status = RATE_VALIDATION.stale;
            error = "Market timestamp stale";
            rate = dec.toString();
            marketTimestamp = fetched.marketTimestamp;
          } else {
            status = RATE_VALIDATION.valid;
            rate = dec.toString();
            marketTimestamp = fetched.marketTimestamp;
            error = null;
            anyValid = true;
          }
        } catch {
          status = RATE_VALIDATION.invalid;
          error = "Invalid rate decimal";
        }
      }

      const existing = await tx.query.rateFeeds.findFirst({
        where: and(
          eq(rateFeeds.providerKey, providerKey),
          eq(rateFeeds.baseCode, pair.baseCode.toUpperCase()),
          eq(rateFeeds.quoteCode, pair.quoteCode.toUpperCase()),
        ),
      });

      if (existing) {
        await tx
          .update(rateFeeds)
          .set({
            providerName,
            rate,
            retrievedAt: status === RATE_VALIDATION.valid ? now : existing.retrievedAt,
            marketTimestamp,
            validationStatus: status,
            lastError: error,
            updatedAt: now,
          })
          .where(eq(rateFeeds.id, existing.id));
      } else {
        await tx.insert(rateFeeds).values({
          id: newId(),
          providerKey,
          providerName,
          baseCode: pair.baseCode.toUpperCase(),
          quoteCode: pair.quoteCode.toUpperCase(),
          rate,
          retrievedAt: status === RATE_VALIDATION.valid ? now : null,
          marketTimestamp,
          validationStatus: status,
          lastError: error,
        });
      }

      await tx.insert(rateFeedSnapshots).values({
        id: newId(),
        providerKey,
        providerName,
        baseCode: pair.baseCode.toUpperCase(),
        quoteCode: pair.quoteCode.toUpperCase(),
        rate,
        retrievedAt: now,
        marketTimestamp,
        validationStatus: status,
        error,
      });
    }

    const existingStatus = await tx.query.providerStatuses.findFirst({
      where: eq(providerStatuses.providerKey, providerKey),
    });
    const providerName = rates[0]?.providerName ?? providerKey;
    if (existingStatus) {
      await tx
        .update(providerStatuses)
        .set({
          providerName,
          isHealthy: anyValid,
          lastSuccessAt: anyValid ? now : existingStatus.lastSuccessAt,
          lastFailureAt: anyValid ? existingStatus.lastFailureAt : now,
          lastError: anyValid ? null : "No valid rates in response",
          updatedAt: now,
        })
        .where(eq(providerStatuses.id, existingStatus.id));
    } else {
      await tx.insert(providerStatuses).values({
        id: newId(),
        providerKey,
        providerName,
        isHealthy: anyValid,
        lastSuccessAt: anyValid ? now : null,
        lastFailureAt: anyValid ? null : now,
        lastError: anyValid ? null : "No valid rates in response",
      });
    }
  });
}

/**
 * Read a usable rate. Never returns a previously saved rate when status is not valid.
 */
export async function getUsableRate(
  providerKey: ProviderKey,
  baseCode: string,
  quoteCode = QUOTE_CURRENCY,
): Promise<UsableRate> {
  const feed = await db.query.rateFeeds.findFirst({
    where: and(
      eq(rateFeeds.providerKey, providerKey),
      eq(rateFeeds.baseCode, baseCode.toUpperCase()),
      eq(rateFeeds.quoteCode, quoteCode.toUpperCase()),
    ),
  });

  if (!feed || feed.validationStatus !== RATE_VALIDATION.valid || !feed.retrievedAt) {
    throw new AppError(
      "RATE_UNAVAILABLE",
      `No valid ${providerKey} rate for ${baseCode}/${quoteCode}`,
      503,
    );
  }

  const age = Date.now() - feed.retrievedAt.getTime();
  if (age > maxAgeMs()) {
    throw new AppError(
      "RATE_STALE",
      `Rate for ${baseCode}/${quoteCode} exceeded max age; refusing last saved value`,
      503,
    );
  }

  return {
    providerKey,
    providerName: feed.providerName,
    baseCode: feed.baseCode,
    quoteCode: feed.quoteCode,
    rate: feed.rate,
    retrievedAt: feed.retrievedAt,
    marketTimestamp: feed.marketTimestamp,
  };
}

export async function getProviderHealth(providerKey: ProviderKey) {
  return db.query.providerStatuses.findFirst({
    where: eq(providerStatuses.providerKey, providerKey),
  });
}

export async function listRateFeeds() {
  return db.query.rateFeeds.findMany();
}

export async function ensureProviderRows() {
  for (const [key, name] of [
    [PROVIDER_KEYS.exchangeRate, "configured_fx_api"],
    [PROVIDER_KEYS.cryptoPrice, "configured_crypto_api"],
  ] as const) {
    const existing = await db.query.providerStatuses.findFirst({
      where: eq(providerStatuses.providerKey, key),
    });
    if (!existing) {
      await db.insert(providerStatuses).values({
        id: newId(),
        providerKey: key,
        providerName: name,
        isHealthy: false,
      });
    }
  }
}
