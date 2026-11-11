import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  lockFiatWalletByUserId,
  withFinancialTransaction,
} from "../../db/transaction";
import {
  auditLogs,
  cryptoWalletBalances,
  cryptoWalletTransactions,
  cryptoWallets,
  currencies,
  fiatWalletTransactions,
  fiatWallets,
  sessions,
  users,
} from "../../db/schema";
import { ACCOUNT_DELETION_FORFEITURE_NOTICE } from "../../auth/constants";
import { verifyPassword } from "../../auth/password";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { newId } from "../../ids";
import { parseOrThrow } from "../../validation/zod";
import { creditCryptoReserve } from "../crypto/reserve";

export const deleteAccountSchema = z.object({
  confirm: z.literal(true),
  acknowledgeForfeiture: z.literal(true),
  /** Step-up: current password required (OAuth-only accounts without passwordHash rejected). */
  currentPassword: z.string().min(8).max(128),
});

/**
 * Customer self-deletion. Requires current password.
 * Wallets are zeroed with immutable forfeiture ledger rows; orders remain.
 */
export async function deleteOwnAccount(userId: string, raw: unknown) {
  const input = parseOrThrow(deleteAccountSchema, raw);

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    with: { role: true },
  });
  if (!user || user.status === "deleted") {
    throw new NotFoundError("User not found");
  }
  if (user.status === "blocked") {
    throw new ForbiddenError("Blocked accounts cannot self-delete");
  }
  if (user.role?.slug !== "customer") {
    throw new ValidationError("Only customers can self-delete via this flow");
  }
  if (!user.passwordHash) {
    throw new ValidationError("Password-based step-up required; set a password first");
  }
  const ok = await verifyPassword(user.passwordHash, input.currentPassword);
  if (!ok) throw new ForbiddenError("Current password is incorrect");

  await withFinancialTransaction(async (tx) => {
    await lockFiatWalletByUserId(tx, userId);

    const fiat = await tx.query.fiatWallets.findFirst({
      where: eq(fiatWallets.userId, userId),
    });
    if (!fiat) {
      throw new ConflictError("Fiat wallet missing");
    }

    if (fiat.balanceToman > 0) {
      const amount = fiat.balanceToman;
      await tx
        .update(fiatWallets)
        .set({ balanceToman: 0, updatedAt: new Date() })
        .where(eq(fiatWallets.id, fiat.id));
      await tx.insert(fiatWalletTransactions).values({
        id: newId(),
        walletId: fiat.id,
        userId,
        type: "adjustment",
        amountToman: -amount,
        balanceBefore: amount,
        balanceAfter: 0,
        referenceType: "account_deletion",
        referenceId: userId,
        note: "Account deletion forfeiture (IRT)",
      });
    }

    const cryptoWallet = await tx.query.cryptoWallets.findFirst({
      where: eq(cryptoWallets.userId, userId),
    });
    if (cryptoWallet) {
      const balances = await tx.query.cryptoWalletBalances.findMany({
        where: eq(cryptoWalletBalances.walletId, cryptoWallet.id),
      });
      for (const balance of balances) {
        const isZero = /^0+(?:\.0+)?$/.test(balance.balance);
        if (isZero) continue;

        await tx.execute(
          sql`SELECT 1 FROM ${cryptoWalletBalances} WHERE ${cryptoWalletBalances.id} = ${balance.id} FOR UPDATE`,
        );

        const currency = await tx.query.currencies.findFirst({
          where: eq(currencies.id, balance.currencyId),
        });
        if (currency?.code) {
          await creditCryptoReserve(tx, currency.code, balance.balance);
        }

        await tx
          .update(cryptoWalletBalances)
          .set({ balance: "0", updatedAt: new Date() })
          .where(eq(cryptoWalletBalances.id, balance.id));

        await tx.insert(cryptoWalletTransactions).values({
          id: newId(),
          walletId: cryptoWallet.id,
          balanceId: balance.id,
          userId,
          currencyId: balance.currencyId,
          type: "adjustment",
          amount: `-${balance.balance}`,
          balanceBefore: balance.balance,
          balanceAfter: "0",
          referenceType: "account_deletion",
          referenceId: userId,
          note: "Account deletion forfeiture (crypto returned to reserve)",
        });
      }
    }

    const anonymizedEmail = `deleted+${userId}@invalid.local`;
    const anonymizedUsername = `deleted_${userId.slice(0, 8)}`;

    await tx
      .update(users)
      .set({
        status: "deleted",
        deletedAt: new Date(),
        email: anonymizedEmail,
        username: anonymizedUsername,
        firstName: "Deleted",
        lastName: "User",
        name: "Deleted User",
        phone: null,
        image: null,
        passwordHash: null,
        emailVerified: null,
        sessionVersion: user.sessionVersion + 1,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    await tx.delete(sessions).where(eq(sessions.userId, userId));

    await tx.insert(auditLogs).values({
      id: newId(),
      actorId: userId,
      action: "user.self_delete",
      entityType: "user",
      entityId: userId,
      before: { status: user.status, email: "[REDACTED]" },
      after: { status: "deleted", forfeiture: true },
    });
  });

  return {
    deleted: true as const,
    notice: ACCOUNT_DELETION_FORFEITURE_NOTICE,
  };
}

export { ACCOUNT_DELETION_FORFEITURE_NOTICE };
