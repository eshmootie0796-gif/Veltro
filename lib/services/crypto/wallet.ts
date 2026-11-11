import { desc, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  cryptoWalletBalances,
  cryptoWallets,
  cryptoWalletTransactions,
} from "../../db/schema";
import type { AuthUser } from "../../auth/rbac";
import { assertVerifiedCustomer } from "../../auth/rbac";
import { NotFoundError } from "../../errors";

export async function getCryptoWallet(customer: AuthUser) {
  assertVerifiedCustomer(customer);
  const wallet = await db.query.cryptoWallets.findFirst({
    where: eq(cryptoWallets.userId, customer.id),
    with: {
      balances: { with: { currency: true } },
    },
  });
  if (!wallet) throw new NotFoundError("Crypto wallet not found");

  return {
    id: wallet.id,
    balances: wallet.balances.map((b) => ({
      currencyCode: b.currency?.code ?? null,
      currencyId: b.currencyId,
      balance: b.balance,
      decimals: b.currency?.decimals ?? null,
      updatedAt: b.updatedAt.toISOString(),
    })),
    updatedAt: wallet.updatedAt.toISOString(),
  };
}

export async function listCryptoTransactions(customer: AuthUser, limit = 50) {
  assertVerifiedCustomer(customer);
  const wallet = await db.query.cryptoWallets.findFirst({
    where: eq(cryptoWallets.userId, customer.id),
  });
  if (!wallet) throw new NotFoundError("Crypto wallet not found");

  const rows = await db.query.cryptoWalletTransactions.findMany({
    where: eq(cryptoWalletTransactions.walletId, wallet.id),
    with: { currency: true },
    orderBy: [desc(cryptoWalletTransactions.createdAt)],
    limit: Math.min(Math.max(limit, 1), 100),
  });

  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    currencyCode: r.currency?.code ?? null,
    amount: r.amount,
    balanceBefore: r.balanceBefore,
    balanceAfter: r.balanceAfter,
    referenceType: r.referenceType,
    referenceId: r.referenceId,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function getCryptoBalanceRow(customerId: string, currencyCode: string) {
  const wallet = await db.query.cryptoWallets.findFirst({
    where: eq(cryptoWallets.userId, customerId),
    with: { balances: { with: { currency: true } } },
  });
  if (!wallet) return null;
  return (
    wallet.balances.find((b) => b.currency?.code === currencyCode.toUpperCase()) ?? null
  );
}
