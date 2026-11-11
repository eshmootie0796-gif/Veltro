import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import type { DbTransaction } from "../../db/transaction";
import {
  lockCryptoReserveForUpdate,
  withReservationTransaction,
} from "../../db/transaction";
import {
  auditLogs,
  cryptoReserves,
  currencies,
  reserveAdjustments,
} from "../../db/schema";
import { assertAdmin, type AuthUser } from "../../auth/rbac";
import { ForbiddenError, InsufficientFundsError, NotFoundError, ValidationError } from "../../errors";
import { newId } from "../../ids";
import { parseOrThrow, zCryptoAmount, zNonEmpty } from "../../validation/zod";
import { d } from "../../money/decimal";

export async function getOrCreateReserve(tx: DbTransaction, currencyCode: string) {
  const currency = await tx.query.currencies.findFirst({
    where: and(eq(currencies.code, currencyCode.toUpperCase()), eq(currencies.kind, "crypto")),
  });
  if (!currency || !currency.isActive) {
    throw new NotFoundError(`Cryptocurrency ${currencyCode} not found`);
  }

  let reserve = await tx.query.cryptoReserves.findFirst({
    where: eq(cryptoReserves.currencyId, currency.id),
  });
  if (!reserve) {
    const id = newId();
    await tx.insert(cryptoReserves).values({
      id,
      currencyId: currency.id,
      balance: "0",
    });
    reserve = await tx.query.cryptoReserves.findFirst({
      where: eq(cryptoReserves.id, id),
    });
  }
  if (!reserve) throw new NotFoundError("Reserve missing");
  return { currency, reserve };
}

export async function debitCryptoReserve(
  tx: DbTransaction,
  currencyCode: string,
  amount: string,
) {
  const qty = d(amount);
  if (!qty.isFinite() || qty.lte(0)) throw new ValidationError("Reserve debit must be positive");

  const { reserve, currency } = await getOrCreateReserve(tx, currencyCode);
  await lockCryptoReserveForUpdate(tx, reserve.id);
  const locked = await tx.query.cryptoReserves.findFirst({
    where: eq(cryptoReserves.id, reserve.id),
  });
  if (!locked) throw new NotFoundError("Reserve missing");

  const before = d(locked.balance);
  if (before.lt(qty)) {
    throw new InsufficientFundsError("Insufficient system cryptocurrency reserve");
  }
  const after = before.sub(qty).toFixed(18);
  await tx
    .update(cryptoReserves)
    .set({ balance: after, updatedAt: new Date() })
    .where(eq(cryptoReserves.id, locked.id));
  return { currencyId: currency.id, reserveId: locked.id, balanceAfter: after };
}

export async function creditCryptoReserve(
  tx: DbTransaction,
  currencyCode: string,
  amount: string,
) {
  const qty = d(amount);
  if (!qty.isFinite() || qty.lte(0)) throw new ValidationError("Reserve credit must be positive");

  const { reserve, currency } = await getOrCreateReserve(tx, currencyCode);
  await lockCryptoReserveForUpdate(tx, reserve.id);
  const locked = await tx.query.cryptoReserves.findFirst({
    where: eq(cryptoReserves.id, reserve.id),
  });
  if (!locked) throw new NotFoundError("Reserve missing");

  const after = d(locked.balance).add(qty).toFixed(18);
  await tx
    .update(cryptoReserves)
    .set({ balance: after, updatedAt: new Date() })
    .where(eq(cryptoReserves.id, locked.id));
  return { currencyId: currency.id, reserveId: locked.id, balanceAfter: after };
}

const increaseSchema = z.object({
  currencyCode: z.string().trim().toUpperCase().min(2).max(16),
  amount: zCryptoAmount,
  reason: zNonEmpty.max(500),
});

/** Admin may only increase reserve. Decreases happen via customer trades only. */
export async function adminIncreaseReserve(actor: AuthUser, raw: unknown) {
  assertAdmin(actor);
  const input = parseOrThrow(increaseSchema, raw);
  if (d(input.amount).lte(0)) throw new ValidationError("Amount must be positive");

  return withReservationTransaction(async (tx) => {
    const credited = await creditCryptoReserve(tx, input.currencyCode, input.amount);
    await tx.insert(reserveAdjustments).values({
      id: newId(),
      reserveId: credited.reserveId,
      currencyId: credited.currencyId,
      amount: d(input.amount).toFixed(18),
      balanceAfter: credited.balanceAfter,
      reason: input.reason,
      actorId: actor.id,
      referenceType: "admin_reserve_increase",
      referenceId: credited.reserveId,
    });
    await tx.insert(auditLogs).values({
      id: newId(),
      actorId: actor.id,
      action: "crypto_reserve.increase",
      entityType: "crypto_reserve",
      entityId: credited.reserveId,
      after: {
        currencyCode: input.currencyCode,
        amount: input.amount,
        balanceAfter: credited.balanceAfter,
      },
    });
    return {
      reserveId: credited.reserveId,
      currencyCode: input.currencyCode,
      balanceAfter: credited.balanceAfter,
    };
  });
}

export async function listReserves(actor: AuthUser) {
  assertAdmin(actor);
  const rows = await db.query.cryptoReserves.findMany({
    with: { currency: true },
  });
  return rows.map((r) => ({
    id: r.id,
    currencyCode: r.currency?.code ?? null,
    balance: r.balance,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/** Hard block: admins never decrease reserve or touch customer crypto balances via admin APIs. */
export function assertAdminCryptoBalanceMutationForbidden(): never {
  throw new ForbiddenError(
    "Administrators cannot manually decrease reserves or modify customer cryptocurrency balances",
  );
}
