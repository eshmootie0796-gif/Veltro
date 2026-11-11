import { and, eq } from "drizzle-orm";
import type { DbTransaction } from "../../db/transaction";
import { orders, orderStatusHistory } from "../../db/schema";
import { ConflictError, InsufficientFundsError, NotFoundError } from "../../errors";
import { newId } from "../../ids";
import { ORDER_STATUSES } from "../../orders/constants";
import { CRYPTO_TX_TYPES } from "../../crypto/constants";
import { consumeDiscountReservation } from "../discounts/service";
import { applyCryptoLedgerEntry } from "../crypto/ledger";
import { creditCryptoReserve, debitCryptoReserve } from "../crypto/reserve";
import { consumeCapacityForOrder } from "./reservations";

/**
 * Transition awaiting_payment → paid inside an open reservation transaction.
 */
export async function markOrderPaidInTx(
  tx: DbTransaction,
  orderId: string,
  actorId: string | null = null,
) {
  const order = await tx.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order) throw new NotFoundError("Order not found");
  if (order.status !== ORDER_STATUSES.awaitingPayment) {
    throw new ConflictError("Order is not awaiting payment");
  }
  if (order.paymentExpiresAt && order.paymentExpiresAt.getTime() < Date.now()) {
    throw new ConflictError("Order payment window expired");
  }

  const updated = await tx
    .update(orders)
    .set({
      status: ORDER_STATUSES.paid,
      lastStatusNote: "Payment received",
      updatedAt: new Date(),
    })
    .where(and(eq(orders.id, orderId), eq(orders.status, ORDER_STATUSES.awaitingPayment)))
    .returning({ id: orders.id });
  if (updated.length === 0) throw new ConflictError("Order status changed concurrently");

  await consumeCapacityForOrder(tx, orderId);
  await consumeDiscountReservation(tx, orderId, order.userId, order.discountToman);
  await fulfillCryptoReserveIfNeeded(tx, order);

  await tx.insert(orderStatusHistory).values({
    id: newId(),
    orderId,
    fromStatus: ORDER_STATUSES.awaitingPayment,
    toStatus: ORDER_STATUSES.paid,
    actorId,
    note: "Payment received",
  });

  return order;
}

function readCryptoFulfillment(pricingSnapshot: Record<string, unknown>) {
  const fulfillment = pricingSnapshot.fulfillment as
    | { type?: string; cryptoSymbol?: string; cryptoAmount?: string }
    | undefined;
  if (!fulfillment || fulfillment.type !== "crypto_reserve") return null;
  if (!fulfillment.cryptoSymbol || !fulfillment.cryptoAmount) {
    throw new ConflictError("Crypto fulfillment data missing");
  }
  return fulfillment as { cryptoSymbol: string; cryptoAmount: string };
}

async function fulfillCryptoReserveIfNeeded(
  tx: DbTransaction,
  order: {
    id: string;
    userId: string;
    pricingSnapshot: Record<string, unknown>;
  },
) {
  const fulfillment = readCryptoFulfillment(order.pricingSnapshot);
  if (!fulfillment) return;

  await debitCryptoReserve(tx, fulfillment.cryptoSymbol, fulfillment.cryptoAmount);
  await applyCryptoLedgerEntry(tx, {
    userId: order.userId,
    currencyCode: fulfillment.cryptoSymbol,
    type: CRYPTO_TX_TYPES.trade,
    amountDelta: fulfillment.cryptoAmount,
    referenceType: "order",
    referenceId: order.id,
    note: "Cryptocurrency order fulfillment via internal reserve",
  });
}

/** Reverse crypto_reserve fulfillment on admin cancel/reject of a paid order. */
export async function reverseCryptoFulfillmentIfNeeded(
  tx: DbTransaction,
  order: {
    id: string;
    userId: string;
    pricingSnapshot: Record<string, unknown>;
  },
) {
  const fulfillment = readCryptoFulfillment(order.pricingSnapshot);
  if (!fulfillment) return;

  try {
    await applyCryptoLedgerEntry(tx, {
      userId: order.userId,
      currencyCode: fulfillment.cryptoSymbol,
      type: CRYPTO_TX_TYPES.adjustment,
      amountDelta: `-${fulfillment.cryptoAmount.replace(/^\+/, "")}`,
      referenceType: "order_refund",
      referenceId: order.id,
      note: "Reverse cryptocurrency order fulfillment",
    });
    await creditCryptoReserve(tx, fulfillment.cryptoSymbol, fulfillment.cryptoAmount);
  } catch (error) {
    // Spent/transferred crypto: still allow fiat cancel/refund; reserve not restored.
    if (error instanceof InsufficientFundsError) {
      return;
    }
    throw error;
  }
}
