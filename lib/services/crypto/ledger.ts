import { and, eq } from "drizzle-orm";
import type { DbTransaction } from "../../db/transaction";
import { lockCryptoBalanceForUpdate } from "../../db/transaction";
import {
  cryptoWalletBalances,
  cryptoWallets,
  cryptoWalletTransactions,
  currencies,
} from "../../db/schema";
import { InsufficientFundsError, NotFoundError, ValidationError } from "../../errors";
import { newId } from "../../ids";
import { d } from "../../money/decimal";

export type CryptoLedgerType = "deposit" | "withdrawal" | "conversion" | "trade" | "adjustment";

async function getCryptoCurrency(tx: DbTransaction, code: string) {
  const row = await tx.query.currencies.findFirst({
    where: and(eq(currencies.code, code.toUpperCase()), eq(currencies.kind, "crypto")),
  });
  if (!row || !row.isActive) throw new NotFoundError(`Cryptocurrency ${code} not found`);
  return row;
}

export async function getOrCreateCustomerCryptoBalance(
  tx: DbTransaction,
  userId: string,
  currencyCode: string,
) {
  const currency = await getCryptoCurrency(tx, currencyCode);
  const wallet = await tx.query.cryptoWallets.findFirst({
    where: eq(cryptoWallets.userId, userId),
  });
  if (!wallet) throw new NotFoundError("Crypto wallet not found");

  let balance = await tx.query.cryptoWalletBalances.findFirst({
    where: and(
      eq(cryptoWalletBalances.walletId, wallet.id),
      eq(cryptoWalletBalances.currencyId, currency.id),
    ),
  });
  if (!balance) {
    const id = newId();
    await tx.insert(cryptoWalletBalances).values({
      id,
      walletId: wallet.id,
      currencyId: currency.id,
      balance: "0",
    });
    balance = await tx.query.cryptoWalletBalances.findFirst({
      where: eq(cryptoWalletBalances.id, id),
    });
  }
  if (!balance) throw new NotFoundError("Crypto balance missing");
  return { wallet, currency, balance };
}

/**
 * Signed delta on customer crypto balance + immutable ledger.
 */
export async function applyCryptoLedgerEntry(
  tx: DbTransaction,
  input: {
    userId: string;
    currencyCode: string;
    type: CryptoLedgerType;
    amountDelta: string;
    referenceType: string;
    referenceId: string;
    note?: string | null;
  },
) {
  const delta = d(input.amountDelta);
  if (!delta.isFinite() || delta.isZero()) {
    throw new ValidationError("Crypto ledger delta must be non-zero");
  }

  const { wallet, currency, balance } = await getOrCreateCustomerCryptoBalance(
    tx,
    input.userId,
    input.currencyCode,
  );
  await lockCryptoBalanceForUpdate(tx, balance.id);
  const locked = await tx.query.cryptoWalletBalances.findFirst({
    where: eq(cryptoWalletBalances.id, balance.id),
  });
  if (!locked) throw new NotFoundError("Crypto balance not found");

  const before = d(locked.balance);
  const after = before.add(delta);
  if (after.isNegative()) {
    throw new InsufficientFundsError("Insufficient cryptocurrency balance");
  }

  const afterStr = after.toFixed(18);
  const beforeStr = before.toFixed(18);

  await tx
    .update(cryptoWalletBalances)
    .set({ balance: afterStr, updatedAt: new Date() })
    .where(eq(cryptoWalletBalances.id, locked.id));

  const id = newId();
  await tx.insert(cryptoWalletTransactions).values({
    id,
    walletId: wallet.id,
    balanceId: locked.id,
    userId: input.userId,
    currencyId: currency.id,
    type: input.type,
    amount: delta.toFixed(18),
    balanceBefore: beforeStr,
    balanceAfter: afterStr,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    note: input.note ?? null,
  });

  return {
    transactionId: id,
    balanceId: locked.id,
    currencyId: currency.id,
    balanceBefore: beforeStr,
    balanceAfter: afterStr,
  };
}
