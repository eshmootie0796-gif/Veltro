import { bigint, boolean, numeric, text, timestamp } from "drizzle-orm/pg-core";
import { newId } from "../../ids";

/**
 * Shared column builders so every table stays consistent:
 * - Toman amounts are integer bigint (never floating point)
 * - crypto quantities and FX rates use numeric(36,18)
 * - ids are UUID strings generated in app code
 * - timestamps are UTC with timezone
 */

/** Opaque string id (uuid) defaulting to a new random value at the app layer. */
export const idColumn = () => text("id").primaryKey().$defaultFn(newId);

/** Integer Toman amount. bigint avoids float drift. */
export const toman = (name = "amount") => bigint(name, { mode: "number" }).notNull();

/** Optional integer Toman amount (nullable). */
export const tomanNullable = (name = "amount") => bigint(name, { mode: "number" });

/** Signed integer Toman amount (ledger deltas). */
export const signedToman = (name = "amount") => bigint(name, { mode: "number" }).notNull();

/**
 * Cryptocurrency quantity or exchange rate.
 * Stored as numeric; application code must use decimal arithmetic, never JS number floats.
 */
export const cryptoNumeric = (name: string) =>
  numeric(name, { precision: 36, scale: 18 }).notNull();

/** UTC timestamp, always with timezone. */
export const utcTimestamp = (name: string) => timestamp(name, { withTimezone: true });

/** Boolean column (real bool type, not text). */
export const bool = (name: string) => boolean(name).notNull().default(false);
