import { eq } from "drizzle-orm";
import type { DbTransaction } from "../../db/transaction";
import { lockFiatWalletByUserId } from "../../db/transaction";
import { fiatWalletTransactions, fiatWallets } from "../../db/schema";
import { ConflictError, InsufficientFundsError, NotFoundError } from "../../errors";
import { newId } from "../../ids";

export type FiatLedgerType = "deposit" | "payment" | "refund" | "adjustment" | "trade";

/**
 * Atomic wallet balance mutation + immutable ledger row.
 * amountDelta signed: credit > 0, debit < 0.
 */
export async function applyFiatLedgerEntry(
  tx: DbTransaction,
  input: {
    userId: string;
    type: FiatLedgerType;
    amountDelta: number;
    referenceType: string;
    referenceId: string;
    note?: string | null;
  },
) {
  if (!Number.isInteger(input.amountDelta)) {
    throw new ConflictError("Ledger amount must be an integer");
  }
  if (input.amountDelta === 0) {
    const wallet = await tx.query.fiatWallets.findFirst({
      where: eq(fiatWallets.userId, input.userId),
    });
    if (!wallet) throw new NotFoundError("Wallet not found");
    return {
      transactionId: null as string | null,
      walletId: wallet.id,
      balanceBefore: wallet.balanceToman,
      balanceAfter: wallet.balanceToman,
      amountToman: 0,
    };
  }

  await lockFiatWalletByUserId(tx, input.userId);
  const wallet = await tx.query.fiatWallets.findFirst({
    where: eq(fiatWallets.userId, input.userId),
  });
  if (!wallet) throw new NotFoundError("Wallet not found");

  const balanceBefore = wallet.balanceToman;
  const balanceAfter = balanceBefore + input.amountDelta;
  if (balanceAfter < 0) {
    throw new InsufficientFundsError("Insufficient wallet balance");
  }

  await tx
    .update(fiatWallets)
    .set({ balanceToman: balanceAfter, updatedAt: new Date() })
    .where(eq(fiatWallets.id, wallet.id));

  const id = newId();
  await tx.insert(fiatWalletTransactions).values({
    id,
    walletId: wallet.id,
    userId: input.userId,
    type: input.type,
    amountToman: input.amountDelta,
    balanceBefore,
    balanceAfter,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    note: input.note ?? null,
  });

  return {
    transactionId: id,
    walletId: wallet.id,
    balanceBefore,
    balanceAfter,
    amountToman: input.amountDelta,
  };
}
