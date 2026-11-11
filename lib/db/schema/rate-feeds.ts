import { pgTable, text, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { idColumn, bool, cryptoNumeric, utcTimestamp } from "./_shared";

/**
 * Current market-data feed per provider + pair.
 * Pricing may use a row only when validation_status = 'valid'.
 * On API failure we mark unavailable and must not use a previous rate.
 */
export const rateFeeds = pgTable(
  "rate_feeds",
  {
    id: idColumn(),
    /** exchange_rate | crypto_price */
    providerKey: text("provider_key").notNull(),
    providerName: text("provider_name").notNull(),
    baseCode: text("base_code").notNull(),
    quoteCode: text("quote_code").notNull().default("IRT"),
    rate: cryptoNumeric("rate").default("0"),
    retrievedAt: utcTimestamp("retrieved_at"),
    marketTimestamp: utcTimestamp("market_timestamp"),
    /** valid | invalid | stale | unavailable */
    validationStatus: text("validation_status").notNull().default("unavailable"),
    lastError: text("last_error"),
    updatedAt: utcTimestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("rate_feeds_provider_pair_idx").on(t.providerKey, t.baseCode, t.quoteCode),
    index("rate_feeds_status_idx").on(t.validationStatus),
    check(
      "rate_feeds_status_chk",
      sql`validation_status IN ('valid', 'invalid', 'stale', 'unavailable')`,
    ),
  ],
);

/**
 * Append-only retrieval log for audit / debugging (no secrets).
 */
export const rateFeedSnapshots = pgTable(
  "rate_feed_snapshots",
  {
    id: idColumn(),
    providerKey: text("provider_key").notNull(),
    providerName: text("provider_name").notNull(),
    baseCode: text("base_code").notNull(),
    quoteCode: text("quote_code").notNull(),
    rate: cryptoNumeric("rate").default("0"),
    retrievedAt: utcTimestamp("retrieved_at").defaultNow().notNull(),
    marketTimestamp: utcTimestamp("market_timestamp"),
    validationStatus: text("validation_status").notNull(),
    error: text("error"),
    createdAt: utcTimestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("rate_feed_snapshots_provider_idx").on(t.providerKey, t.createdAt),
    index("rate_feed_snapshots_pair_idx").on(t.baseCode, t.quoteCode),
  ],
);

/**
 * Provider health for order-creation gating.
 */
export const providerStatuses = pgTable(
  "provider_statuses",
  {
    id: idColumn(),
    providerKey: text("provider_key").notNull().unique(),
    providerName: text("provider_name").notNull(),
    isHealthy: bool("is_healthy").default(false),
    lastSuccessAt: utcTimestamp("last_success_at"),
    lastFailureAt: utcTimestamp("last_failure_at"),
    lastError: text("last_error"),
    updatedAt: utcTimestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("provider_statuses_healthy_idx").on(t.isHealthy)],
);
