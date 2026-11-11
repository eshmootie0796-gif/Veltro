import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import type { DbTransaction } from "../../db/transaction";
import { withReservationTransaction } from "../../db/transaction";
import {
  orders,
  orderStatusHistory,
  payments,
  users,
} from "../../db/schema";
import type { AuthUser } from "../../auth/rbac";
import { assertVerifiedCustomer } from "../../auth/rbac";
import {
  ConflictError,
  InsufficientFundsError,
  NotFoundError,
  ValidationError,
} from "../../errors";
import { newId } from "../../ids";
import { parseOrThrow } from "../../validation/zod";
import {
  MOCK_OUTCOMES,
  PAYMENT_METHODS,
  PAYMENT_PURPOSES,
  PAYMENT_STATUSES,
  WALLET_TX_TYPES,
} from "../../payments/constants";
import { assertMockPaymentsAllowed } from "../../payments/mock-gate";
import { ORDER_STATUSES } from "../../orders/constants";
import { NOTIFICATION_TYPES } from "../../notifications/constants";
import { notifyUser } from "../notifications/service";
import { applyFiatLedgerEntry } from "../wallet/ledger";
import { markOrderPaidInTx } from "../orders/mark-paid";
import { releaseOrderHolds } from "../orders/reservations";

const paySchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal(PAYMENT_METHODS.walletFiat),
  }),
  z.object({
    method: z.literal(PAYMENT_METHODS.simulatedGateway),
    /** Server mock control knob — not a client success claim. */
    simulate: z.enum([MOCK_OUTCOMES.success, MOCK_OUTCOMES.failure]),
  }),
]);

async function loadPayableOrder(tx: DbTransaction, orderId: string, userId: string) {
  const order = await tx.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order) throw new NotFoundError("Order not found");
  if (order.userId !== userId) throw new NotFoundError("Order not found");
  if (order.status !== ORDER_STATUSES.awaitingPayment) {
    throw new ValidationError("Order is not awaiting payment");
  }
  if (order.paymentExpiresAt && order.paymentExpiresAt.getTime() < Date.now()) {
    throw new ConflictError("Order payment window expired");
  }

  const existingSuccess = await tx.query.payments.findFirst({
    where: and(
      eq(payments.orderId, orderId),
      eq(payments.status, PAYMENT_STATUSES.succeeded),
    ),
  });
  if (existingSuccess) {
    throw new ConflictError("Order already has a successful payment");
  }

  return order;
}

async function failOrderAfterDirectPayment(
  tx: DbTransaction,
  orderId: string,
  actorId: string,
  reason: string,
) {
  const updated = await tx
    .update(orders)
    .set({
      status: ORDER_STATUSES.cancelled,
      lastStatusNote: reason,
      updatedAt: new Date(),
    })
    .where(and(eq(orders.id, orderId), eq(orders.status, ORDER_STATUSES.awaitingPayment)))
    .returning({ id: orders.id });
  if (updated.length === 0) return;

  await releaseOrderHolds(tx, orderId, "released");
  await tx.insert(orderStatusHistory).values({
    id: newId(),
    orderId,
    fromStatus: ORDER_STATUSES.awaitingPayment,
    toStatus: ORDER_STATUSES.cancelled,
    actorId,
    note: reason,
  });
}

export async function payOrder(customer: AuthUser, orderId: string, raw: unknown) {
  assertVerifiedCustomer(customer);
  const input = parseOrThrow(paySchema, raw);

  if (input.method === PAYMENT_METHODS.walletFiat) {
    return payOrderWithWallet(customer, orderId);
  }
  assertMockPaymentsAllowed("order.pay.simulated_gateway");
  return payOrderWithMockGateway(customer, orderId, input.simulate);
}

async function payOrderWithWallet(customer: AuthUser, orderId: string) {
  try {
    const result = await withReservationTransaction(async (tx) => {
      const order = await loadPayableOrder(tx, orderId, customer.id);
      const paymentId = newId();

      await tx.insert(payments).values({
        id: paymentId,
        purpose: PAYMENT_PURPOSES.order,
        orderId,
        userId: customer.id,
        method: PAYMENT_METHODS.walletFiat,
        status: PAYMENT_STATUSES.pending,
        amountToman: order.payableToman,
        gatewayRef: `wallet_${paymentId}`,
      });

      await applyFiatLedgerEntry(tx, {
        userId: customer.id,
        type: WALLET_TX_TYPES.payment,
        amountDelta: -order.payableToman,
        referenceType: "payment",
        referenceId: paymentId,
        note: `Order payment ${orderId}`,
      });

      await tx
        .update(payments)
        .set({ status: PAYMENT_STATUSES.succeeded, updatedAt: new Date() })
        .where(eq(payments.id, paymentId));

      await markOrderPaidInTx(tx, orderId, customer.id);

      return {
        paymentId,
        method: PAYMENT_METHODS.walletFiat,
        status: PAYMENT_STATUSES.succeeded,
        orderId,
        orderStatus: ORDER_STATUSES.paid,
        amountToman: order.payableToman,
      };
    });
    await notifyUser({
      userId: customer.id,
      type: NOTIFICATION_TYPES.paymentSuccessful,
      vars: { orderId },
    });
    return result;
  } catch (error) {
    if (error instanceof InsufficientFundsError) {
      // Order + reservations stay alive for retry until paymentExpiresAt.
      throw error;
    }
    throw error;
  }
}

async function payOrderWithMockGateway(
  customer: AuthUser,
  orderId: string,
  simulate: "success" | "failure",
) {
  const result = await withReservationTransaction(async (tx) => {
    const order = await loadPayableOrder(tx, orderId, customer.id);
    const paymentId = newId();

    await tx.insert(payments).values({
      id: paymentId,
      purpose: PAYMENT_PURPOSES.order,
      orderId,
      userId: customer.id,
      method: PAYMENT_METHODS.simulatedGateway,
      status: PAYMENT_STATUSES.pending,
      amountToman: order.payableToman,
      gatewayRef: `mock_order_${paymentId}`,
    });

    if (simulate === MOCK_OUTCOMES.failure) {
      await tx
        .update(payments)
        .set({
          status: PAYMENT_STATUSES.failed,
          failureReason: "Simulated direct payment failure",
          updatedAt: new Date(),
        })
        .where(eq(payments.id, paymentId));

      await failOrderAfterDirectPayment(
        tx,
        orderId,
        customer.id,
        "Direct payment failed; create a new order",
      );

      return {
        paymentId,
        method: PAYMENT_METHODS.simulatedGateway,
        status: PAYMENT_STATUSES.failed,
        orderId,
        orderStatus: ORDER_STATUSES.cancelled,
        amountToman: order.payableToman,
        retryAllowed: false as const,
      };
    }

    await tx
      .update(payments)
      .set({ status: PAYMENT_STATUSES.succeeded, updatedAt: new Date() })
      .where(eq(payments.id, paymentId));

    await markOrderPaidInTx(tx, orderId, customer.id);

    return {
      paymentId,
      method: PAYMENT_METHODS.simulatedGateway,
      status: PAYMENT_STATUSES.succeeded,
      orderId,
      orderStatus: ORDER_STATUSES.paid,
      amountToman: order.payableToman,
      retryAllowed: false as const,
    };
  });

  if (result.status === PAYMENT_STATUSES.failed) {
    await notifyUser({
      userId: customer.id,
      type: NOTIFICATION_TYPES.paymentFailed,
      vars: { orderId },
    });
  } else {
    await notifyUser({
      userId: customer.id,
      type: NOTIFICATION_TYPES.paymentSuccessful,
      vars: { orderId },
    });
  }
  return result;
}

/**
 * Idempotent full refund of succeeded order payment into Toman wallet.
 * Deleted accounts: no credit; payment marked forfeited_refund.
 */
export async function refundOrderPaymentInTx(tx: DbTransaction, orderId: string) {
  const succeeded = await tx.query.payments.findFirst({
    where: and(
      eq(payments.orderId, orderId),
      eq(payments.purpose, PAYMENT_PURPOSES.order),
      eq(payments.status, PAYMENT_STATUSES.succeeded),
    ),
  });
  if (!succeeded) {
    const already = await tx.query.payments.findFirst({
      where: and(
        eq(payments.orderId, orderId),
        eq(payments.purpose, PAYMENT_PURPOSES.order),
      ),
    });
    if (
      already &&
      (already.status === PAYMENT_STATUSES.refunded ||
        already.status === PAYMENT_STATUSES.forfeitedRefund)
    ) {
      return { refunded: false as const, reason: "already_handled" as const };
    }
    return { refunded: false as const, reason: "no_succeeded_payment" as const };
  }

  await tx.execute(sql`SELECT 1 FROM payments WHERE id = ${succeeded.id} FOR UPDATE`);
  const locked = await tx.query.payments.findFirst({ where: eq(payments.id, succeeded.id) });
  if (!locked || locked.status !== PAYMENT_STATUSES.succeeded) {
    return { refunded: false as const, reason: "already_handled" as const };
  }

  const owner = await tx.query.users.findFirst({ where: eq(users.id, locked.userId) });
  if (!owner || owner.status === "deleted" || owner.deletedAt) {
    const forfeited = await tx
      .update(payments)
      .set({
        status: PAYMENT_STATUSES.forfeitedRefund,
        failureReason: "Refund forfeited: account deleted",
        updatedAt: new Date(),
      })
      .where(and(eq(payments.id, locked.id), eq(payments.status, PAYMENT_STATUSES.succeeded)))
      .returning({ id: payments.id });
    if (forfeited.length === 0) {
      throw new ConflictError("Refund race: payment status changed");
    }
    return { refunded: false as const, reason: "account_deleted" as const };
  }

  // Claim refund first so a concurrent refund cannot credit twice.
  const claimed = await tx
    .update(payments)
    .set({ status: PAYMENT_STATUSES.refunded, updatedAt: new Date() })
    .where(and(eq(payments.id, locked.id), eq(payments.status, PAYMENT_STATUSES.succeeded)))
    .returning({ id: payments.id });
  if (claimed.length === 0) {
    throw new ConflictError("Refund race: payment already refunded");
  }

  await applyFiatLedgerEntry(tx, {
    userId: locked.userId,
    type: WALLET_TX_TYPES.refund,
    amountDelta: locked.amountToman,
    referenceType: "payment_refund",
    referenceId: locked.id,
    note: `Full refund for order ${orderId}`,
  });

  return {
    refunded: true as const,
    paymentId: locked.id,
    amountToman: locked.amountToman,
  };
}

export async function getOrderPayments(customer: AuthUser, orderId: string) {
  assertVerifiedCustomer(customer);
  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order) throw new NotFoundError("Order not found");
  if (order.userId !== customer.id) throw new NotFoundError("Order not found");

  const rows = await db.query.payments.findMany({
    where: eq(payments.orderId, orderId),
  });
  return rows.map((p) => ({
    id: p.id,
    method: p.method,
    status: p.status,
    amountToman: p.amountToman,
    failureReason: p.failureReason,
    createdAt: p.createdAt.toISOString(),
  }));
}
