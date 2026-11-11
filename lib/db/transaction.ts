import { sql } from "drizzle-orm";
import { db, type Database } from "./index";
import {
  cryptoReserves,
  cryptoWalletBalances,
  discounts,
  fiatWallets,
  platformFiatTreasury,
  productVariants,
} from "./schema";

/**
 * Typed transaction client used inside withTransaction callbacks.
 */
export type DbTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type DbExecutor = Database | DbTransaction;

type IsolationLevel = "read committed" | "repeatable read" | "serializable";

export type TransactionOptions = {
  /** Postgres isolation level. Use serializable for contested financial paths when needed. */
  isolationLevel?: IsolationLevel;
};

/**
 * Run work inside a database transaction.
 * Prefer this for any multi-row financial or capacity mutation.
 */
export async function withTransaction<T>(
  fn: (tx: DbTransaction) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  return db.transaction(async (tx) => {
    if (options.isolationLevel) {
      await tx.execute(
        sql.raw(`SET TRANSACTION ISOLATION LEVEL ${options.isolationLevel.toUpperCase()}`),
      );
    }
    return fn(tx);
  });
}

/**
 * Convenience wrapper for financial / inventory mutations.
 * Uses REPEATABLE READ by default (pair with FOR UPDATE row locks).
 */
export async function withFinancialTransaction<T>(
  fn: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  return withTransaction(fn, { isolationLevel: "repeatable read" });
}

/**
 * Capacity / discount reservation paths.
 * READ COMMITTED so FOR UPDATE waiters see fresh counts after lock acquire.
 */
export async function withReservationTransaction<T>(
  fn: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  return withTransaction(fn, { isolationLevel: "read committed" });
}

/**
 * Lock a fiat wallet row by user id.
 */
export async function lockFiatWalletByUserId(tx: DbTransaction, userId: string): Promise<void> {
  await tx.execute(sql`SELECT 1 FROM ${fiatWallets} WHERE ${fiatWallets.userId} = ${userId} FOR UPDATE`);
}

/**
 * Lock a product variant row (capacity).
 */
export async function lockVariantForUpdate(tx: DbTransaction, variantId: string): Promise<void> {
  await tx.execute(
    sql`SELECT 1 FROM ${productVariants} WHERE ${productVariants.id} = ${variantId} FOR UPDATE`,
  );
}

/**
 * Lock a crypto wallet balance row.
 */
export async function lockCryptoBalanceForUpdate(
  tx: DbTransaction,
  balanceId: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT 1 FROM ${cryptoWalletBalances} WHERE ${cryptoWalletBalances.id} = ${balanceId} FOR UPDATE`,
  );
}

/**
 * Lock a discount row before reservation / usage accounting.
 */
export async function lockDiscountForUpdate(tx: DbTransaction, discountId: string): Promise<void> {
  await tx.execute(sql`SELECT 1 FROM ${discounts} WHERE ${discounts.id} = ${discountId} FOR UPDATE`);
}

export async function lockCryptoReserveForUpdate(
  tx: DbTransaction,
  reserveId: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT 1 FROM ${cryptoReserves} WHERE ${cryptoReserves.id} = ${reserveId} FOR UPDATE`,
  );
}

export async function lockPlatformTreasuryForUpdate(
  tx: DbTransaction,
  treasuryId: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT 1 FROM ${platformFiatTreasury} WHERE ${platformFiatTreasury.id} = ${treasuryId} FOR UPDATE`,
  );
}
