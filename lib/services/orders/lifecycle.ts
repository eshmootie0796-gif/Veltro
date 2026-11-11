import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { backgroundJobs, orders, orderStatusHistory } from "../../db/schema";
import { withReservationTransaction } from "../../db/transaction";
import type { AuthUser } from "../../auth/rbac";
import { assertAdmin } from "../../auth/rbac";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";
import { newId } from "../../ids";
import { parseOrThrow, zNonEmpty } from "../../validation/zod";
import {
  ADMIN_ALLOWED_TRANSITIONS,
  ORDER_STATUSES,
  PRE_DELIVERY_STATUSES,
  type OrderStatus,
} from "../../orders/constants";
import { NOTIFICATION_TYPES } from "../../notifications/constants";
import { writeAuditLog } from "../audit/write";
import { notifyUser } from "../notifications/service";
import { refundOrderPaymentInTx } from "../payments/service";
import { markOrderPaidInTx, reverseCryptoFulfillmentIfNeeded } from "./mark-paid";
import {
  releaseOrderHolds,
  releasePaidOrderResources,
} from "./reservations";

async function getOwnedOrder(orderId: string, userId?: string) {
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
    with: { items: true, statusHistory: true },
  });
  if (!order) throw new NotFoundError("Order not found");
  // Same 404 for missing and non-owned — avoid IDOR existence oracle.
  if (userId && order.userId !== userId) throw new NotFoundError("Order not found");
  return order;
}

async function transition(
  orderId: string,
  fromStatus: string,
  toStatus: OrderStatus,
  actorId: string | null,
  note?: string | null,
) {
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(orders)
      .set({
        status: toStatus,
        lastStatusNote: note ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(orders.id, orderId), eq(orders.status, fromStatus)))
      .returning({ id: orders.id });

    if (updated.length === 0) {
      throw new ConflictError("Order status changed concurrently");
    }

    await tx.insert(orderStatusHistory).values({
      id: newId(),
      orderId,
      fromStatus,
      toStatus,
      actorId,
      note: note ?? null,
    });
  });
}

/** Customer cancels unpaid order immediately. */
export async function cancelUnpaidOrder(customer: AuthUser, orderId: string) {
  const order = await getOwnedOrder(orderId, customer.id);
  if (order.status !== ORDER_STATUSES.awaitingPayment) {
    throw new ValidationError("Only unpaid orders can be cancelled by the customer");
  }

  await withReservationTransaction(async (tx) => {
    const updated = await tx
      .update(orders)
      .set({
        status: ORDER_STATUSES.cancelled,
        lastStatusNote: "Cancelled by customer",
        updatedAt: new Date(),
      })
      .where(and(eq(orders.id, orderId), eq(orders.status, ORDER_STATUSES.awaitingPayment)))
      .returning({ id: orders.id });
    if (updated.length === 0) throw new ConflictError("Order already changed");

    await releaseOrderHolds(tx, orderId, "released");
    await tx.insert(orderStatusHistory).values({
      id: newId(),
      orderId,
      fromStatus: ORDER_STATUSES.awaitingPayment,
      toStatus: ORDER_STATUSES.cancelled,
      actorId: customer.id,
      note: "Cancelled by customer",
    });
  });

  return { id: orderId, status: ORDER_STATUSES.cancelled };
}

/** Paid order: customer requests cancellation (admin must approve). */
export async function requestCancellation(customer: AuthUser, orderId: string, note?: string) {
  const order = await getOwnedOrder(orderId, customer.id);
  if (!PRE_DELIVERY_STATUSES.includes(order.status as OrderStatus)) {
    throw new ValidationError("Cancellation not allowed in current status");
  }
  if (order.status === ORDER_STATUSES.awaitingPayment) {
    throw new ValidationError("Use cancel for unpaid orders");
  }
  if (order.status === ORDER_STATUSES.completed) {
    throw new ValidationError("Delivered orders cannot be cancelled");
  }

  await transition(
    orderId,
    order.status,
    ORDER_STATUSES.cancellationRequested,
    customer.id,
    note ?? "Cancellation requested by customer",
  );
  return { id: orderId, status: ORDER_STATUSES.cancellationRequested };
}

const adminStatusSchema = z.object({
  // `paid` is not free-form — only payment flows call markOrderPaidInTx.
  status: z.enum([
    "pending_admin_review",
    "processing",
    "completed",
    "cancelled",
    "rejected",
  ]),
  note: zNonEmpty.max(2000),
});

export async function adminUpdateOrderStatus(actor: AuthUser, orderId: string, raw: unknown) {
  assertAdmin(actor);
  const input = parseOrThrow(adminStatusSchema, raw);
  const order = await getOwnedOrder(orderId);
  const fromStatus = order.status as OrderStatus;
  const allowed = ADMIN_ALLOWED_TRANSITIONS[fromStatus] ?? [];
  if (!allowed.includes(input.status as OrderStatus)) {
    throw new ValidationError(
      `Cannot transition order from ${fromStatus} to ${input.status}`,
    );
  }

  // Approving cancellation on paid pre-delivery orders
  if (
    input.status === ORDER_STATUSES.cancelled &&
    fromStatus !== ORDER_STATUSES.awaitingPayment &&
    fromStatus !== ORDER_STATUSES.cancellationRequested &&
    fromStatus !== ORDER_STATUSES.pendingAdminReview
  ) {
    if (!PRE_DELIVERY_STATUSES.includes(fromStatus)) {
      throw new ValidationError("Cannot cancel after delivery");
    }
  }

  let refundedAmount: number | null = null;
  let refundPaymentId: string | null = null;

  await withReservationTransaction(async (tx) => {
    const updated = await tx
      .update(orders)
      .set({
        status: input.status,
        lastStatusNote: input.note,
        updatedAt: new Date(),
      })
      .where(and(eq(orders.id, orderId), eq(orders.status, order.status)))
      .returning({ id: orders.id });
    if (updated.length === 0) throw new ConflictError("Order status changed concurrently");

    if (
      input.status === ORDER_STATUSES.cancelled ||
      input.status === ORDER_STATUSES.rejected
    ) {
      if (order.status === ORDER_STATUSES.awaitingPayment) {
        await releaseOrderHolds(tx, orderId, "released");
      } else if (order.status !== ORDER_STATUSES.expired) {
        await reverseCryptoFulfillmentIfNeeded(tx, order);
        await releasePaidOrderResources(tx, orderId);
        const refund = await refundOrderPaymentInTx(tx, orderId);
        if (refund.refunded) {
          refundedAmount = refund.amountToman;
          refundPaymentId = refund.paymentId;
        }
      }
    }

    await tx.insert(orderStatusHistory).values({
      id: newId(),
      orderId,
      fromStatus: order.status,
      toStatus: input.status,
      actorId: actor.id,
      note: input.note,
    });
  });

  const action =
    input.status === ORDER_STATUSES.cancelled || input.status === ORDER_STATUSES.rejected
      ? order.status === ORDER_STATUSES.cancellationRequested
        ? "order.cancellation_approve"
        : input.status === ORDER_STATUSES.rejected
          ? "order.reject"
          : "order.cancel"
      : "order.status_update";

  await writeAuditLog({
    actorId: actor.id,
    action,
    entityType: "order",
    entityId: orderId,
    before: { status: order.status },
    after: { status: input.status, note: input.note },
  });

  if (input.status === ORDER_STATUSES.processing) {
    await notifyUser({
      userId: order.userId,
      type: NOTIFICATION_TYPES.processingStarted,
      vars: { orderId },
    });
  } else if (input.status === ORDER_STATUSES.completed) {
    await notifyUser({
      userId: order.userId,
      type: NOTIFICATION_TYPES.orderDelivered,
      vars: { orderId },
    });
  } else if (
    input.status === ORDER_STATUSES.cancelled &&
    order.status === ORDER_STATUSES.cancellationRequested
  ) {
    await notifyUser({
      userId: order.userId,
      type: NOTIFICATION_TYPES.cancellationApproved,
      vars: { orderId },
    });
  }

  if (refundedAmount !== null) {
    await notifyUser({
      userId: order.userId,
      type: NOTIFICATION_TYPES.walletRefund,
      vars: { amountToman: refundedAmount, orderId },
    });
    await writeAuditLog({
      actorId: actor.id,
      action: "payment.refund",
      entityType: "order",
      entityId: orderId,
      after: { amountToman: refundedAmount, paymentId: refundPaymentId },
    });
  }

  return { id: orderId, status: input.status };
}

/** Reject cancellation request: return order to processing. */
export async function adminRejectCancellation(actor: AuthUser, orderId: string, note: string) {
  assertAdmin(actor);
  const order = await getOwnedOrder(orderId);
  if (order.status !== ORDER_STATUSES.cancellationRequested) {
    throw new ValidationError("Order is not awaiting cancellation approval");
  }

  await transition(
    orderId,
    ORDER_STATUSES.cancellationRequested,
    ORDER_STATUSES.processing,
    actor.id,
    note,
  );

  await writeAuditLog({
    actorId: actor.id,
    action: "order.cancellation_reject",
    entityType: "order",
    entityId: orderId,
    before: { status: order.status },
    after: { status: ORDER_STATUSES.processing, note },
  });

  await notifyUser({
    userId: order.userId,
    type: NOTIFICATION_TYPES.cancellationRejected,
    vars: { orderId },
  });

  return { id: orderId, status: ORDER_STATUSES.processing };
}

/**
 * Mark order paid (payment module will call this). Consumes reservations.
 * Exported for tests and simulated gateway.
 */
export async function markOrderPaid(orderId: string, actorId: string | null = null) {
  await withReservationTransaction(async (tx) => {
    await markOrderPaidInTx(tx, orderId, actorId);
  });
  return { id: orderId, status: ORDER_STATUSES.paid };
}

/**
 * Idempotent expiration job using SKIP LOCKED inside one transaction.
 */
export async function expireUnpaidOrders(limit = 50) {
  const jobId = newId();
  await db.insert(backgroundJobs).values({
    id: jobId,
    type: "expire_unpaid_orders",
    status: "running",
    startedAt: new Date(),
    payload: { limit },
  });

  const nowIso = new Date().toISOString();
  let expiredCount = 0;
  let claimed = 0;

  await db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL READ COMMITTED`);
    const claimedRows = await tx.execute<{ id: string }>(sql`
      SELECT id FROM orders
      WHERE status = ${ORDER_STATUSES.awaitingPayment}
        AND payment_expires_at IS NOT NULL
        AND payment_expires_at < ${nowIso}::timestamptz
      ORDER BY payment_expires_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    `);

    const rows = claimedRows as unknown as Array<{ id: string }>;
    const ids = Array.from(rows, (r) => r.id).filter(Boolean);
    claimed = ids.length;

    for (const orderId of ids) {
      const updated = await tx
        .update(orders)
        .set({
          status: ORDER_STATUSES.expired,
          lastStatusNote: "Payment window expired",
          updatedAt: new Date(),
        })
        .where(and(eq(orders.id, orderId), eq(orders.status, ORDER_STATUSES.awaitingPayment)))
        .returning({ id: orders.id });
      if (updated.length === 0) continue;

      await releaseOrderHolds(tx, orderId, "expired");
      await tx.insert(orderStatusHistory).values({
        id: newId(),
        orderId,
        fromStatus: ORDER_STATUSES.awaitingPayment,
        toStatus: ORDER_STATUSES.expired,
        actorId: null,
        note: "Payment window expired",
      });
      expiredCount += 1;
    }
  });

  await db
    .update(backgroundJobs)
    .set({
      status: "succeeded",
      result: { expiredCount, claimed },
      finishedAt: new Date(),
    })
    .where(eq(backgroundJobs.id, jobId));

  return { jobId, expiredCount, claimed };
}

export async function getOrderForCustomer(customer: AuthUser, orderId: string) {
  const order = await getOwnedOrder(orderId, customer.id);
  return mapOrder(order);
}

export async function listCustomerOrders(customer: AuthUser) {
  const rows = await db.query.orders.findMany({
    where: eq(orders.userId, customer.id),
    with: { items: true, statusHistory: true },
    orderBy: [desc(orders.createdAt)],
  });
  return rows.map(mapOrder);
}

export async function getOrderAdmin(actor: AuthUser, orderId: string) {
  assertAdmin(actor);
  const order = await getOwnedOrder(orderId);
  return mapOrder(order);
}

function mapOrder(order: {
  id: string;
  userId: string;
  status: string;
  payableToman: number;
  discountToman: number;
  subtotalToman: number;
  feeToman: number;
  fixedCostToman: number;
  discountCodeSnapshot: string | null;
  pricingSnapshot: Record<string, unknown>;
  customerInputSnapshot: Record<string, unknown> | null;
  paymentExpiresAt: Date | null;
  lastStatusNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  items?: unknown[];
  statusHistory?: Array<{
    fromStatus: string | null;
    toStatus: string;
    note: string | null;
    createdAt: Date;
    actorId: string | null;
  }>;
}) {
  return {
    id: order.id,
    userId: order.userId,
    status: order.status,
    payableToman: order.payableToman,
    discountToman: order.discountToman,
    subtotalToman: order.subtotalToman,
    feeToman: order.feeToman,
    fixedCostToman: order.fixedCostToman,
    discountCode: order.discountCodeSnapshot,
    pricingSnapshot: order.pricingSnapshot,
    customerInput: order.customerInputSnapshot,
    paymentExpiresAt: order.paymentExpiresAt?.toISOString() ?? null,
    lastStatusNote: order.lastStatusNote,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    items: order.items ?? [],
    statusHistory: (order.statusHistory ?? []).map((h) => ({
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      note: h.note,
      actorId: h.actorId,
      at: h.createdAt.toISOString(),
    })),
  };
}
