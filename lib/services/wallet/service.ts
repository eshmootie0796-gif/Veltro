import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { withReservationTransaction } from "../../db/transaction";
import { fiatWalletTransactions, fiatWallets, payments, users } from "../../db/schema";
import type { AuthUser } from "../../auth/rbac";
import { assertVerifiedCustomer } from "../../auth/rbac";
import { ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { newId } from "../../ids";
import { parseOrThrow, zToman } from "../../validation/zod";
import {
  MOCK_OUTCOMES,
  PAYMENT_METHODS,
  PAYMENT_PURPOSES,
  PAYMENT_STATUSES,
  WALLET_TX_TYPES,
} from "../../payments/constants";
import { assertMockPaymentsAllowed } from "../../payments/mock-gate";
import { applyFiatLedgerEntry } from "./ledger";
import { getTopupLimits } from "./settings";

export async function getWallet(customer: AuthUser) {
  assertVerifiedCustomer(customer);
  const wallet = await db.query.fiatWallets.findFirst({
    where: eq(fiatWallets.userId, customer.id),
  });
  if (!wallet) throw new NotFoundError("Wallet not found");
  return {
    id: wallet.id,
    balanceToman: wallet.balanceToman,
    currencyCode: "IRT",
    updatedAt: wallet.updatedAt.toISOString(),
  };
}

export async function listWalletTransactions(customer: AuthUser, limit = 50) {
  assertVerifiedCustomer(customer);
  const wallet = await db.query.fiatWallets.findFirst({
    where: eq(fiatWallets.userId, customer.id),
  });
  if (!wallet) throw new NotFoundError("Wallet not found");

  const rows = await db.query.fiatWalletTransactions.findMany({
    where: eq(fiatWalletTransactions.walletId, wallet.id),
    orderBy: [desc(fiatWalletTransactions.createdAt)],
    limit: Math.min(Math.max(limit, 1), 100),
  });

  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    amountToman: r.amountToman,
    balanceBefore: r.balanceBefore,
    balanceAfter: r.balanceAfter,
    referenceType: r.referenceType,
    referenceId: r.referenceId,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
  }));
}

const topupSchema = z.object({
  amountToman: zToman.min(1),
  /** Server-controlled mock outcome. Not a client claim of success. */
  simulate: z.enum([MOCK_OUTCOMES.success, MOCK_OUTCOMES.failure]),
});

/**
 * Mock direct top-up. Credits wallet only when simulate=success.
 */
export async function mockWalletTopup(customer: AuthUser, raw: unknown) {
  assertVerifiedCustomer(customer);
  assertMockPaymentsAllowed("wallet.topup.simulated_gateway");
  const input = parseOrThrow(topupSchema, raw);
  const limits = await getTopupLimits();
  if (input.amountToman < limits.minToman || input.amountToman > limits.maxToman) {
    throw new ValidationError(
      `Top-up amount must be between ${limits.minToman} and ${limits.maxToman} Toman`,
    );
  }

  const user = await db.query.users.findFirst({ where: eq(users.id, customer.id) });
  if (!user || user.status !== "active") {
    throw new ForbiddenError("Account is not active");
  }

  return withReservationTransaction(async (tx) => {
    const paymentId = newId();
    await tx.insert(payments).values({
      id: paymentId,
      purpose: PAYMENT_PURPOSES.topup,
      orderId: null,
      userId: customer.id,
      method: PAYMENT_METHODS.simulatedGateway,
      status: PAYMENT_STATUSES.pending,
      amountToman: input.amountToman,
      gatewayRef: `mock_topup_${paymentId}`,
    });

    if (input.simulate === MOCK_OUTCOMES.failure) {
      await tx
        .update(payments)
        .set({
          status: PAYMENT_STATUSES.failed,
          failureReason: "Simulated top-up failure",
          updatedAt: new Date(),
        })
        .where(eq(payments.id, paymentId));
      return {
        paymentId,
        status: PAYMENT_STATUSES.failed,
        credited: false as const,
      };
    }

    const ledger = await applyFiatLedgerEntry(tx, {
      userId: customer.id,
      type: WALLET_TX_TYPES.deposit,
      amountDelta: input.amountToman,
      referenceType: "payment",
      referenceId: paymentId,
      note: "Mock wallet top-up",
    });

    await tx
      .update(payments)
      .set({
        status: PAYMENT_STATUSES.succeeded,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, paymentId));

    return {
      paymentId,
      status: PAYMENT_STATUSES.succeeded,
      credited: true as const,
      balanceAfter: ledger.balanceAfter,
      transactionId: ledger.transactionId,
    };
  });
}
