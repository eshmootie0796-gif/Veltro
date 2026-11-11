import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  backgroundJobs,
  capacityReservations,
  discountReservations,
  orders,
  orderStatusHistory,
  providerStatuses,
} from "../../db/schema";
import { newId } from "../../ids";
import { ORDER_STATUSES } from "../../orders/constants";
import { logger } from "../../logger";
import { refreshMarketRates } from "../../pricing/refresh";
import { PROVIDER_KEYS } from "../../pricing/constants";
import { expireUnpaidOrders } from "../orders/lifecycle";
import { releaseOrderHolds } from "../orders/reservations";

async function recordJob(
  type: string,
  run: () => Promise<Record<string, unknown>>,
) {
  const jobId = newId();
  await db.insert(backgroundJobs).values({
    id: jobId,
    type,
    status: "running",
    startedAt: new Date(),
    payload: {},
  });
  try {
    const result = await run();
    await db
      .update(backgroundJobs)
      .set({ status: "succeeded", result, finishedAt: new Date() })
      .where(eq(backgroundJobs.id, jobId));
    return { jobId, ...result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "job failed";
    await db
      .update(backgroundJobs)
      .set({
        status: "failed",
        error: message,
        finishedAt: new Date(),
      })
      .where(eq(backgroundJobs.id, jobId));
    throw error;
  }
}

/**
 * Release reserved capacity/discount rows past expires_at.
 * Idempotent. Safe under concurrency via SKIP LOCKED + status guards.
 * If parent order still awaiting payment, expire it first so inventory stays consistent.
 */
export async function releaseExpiredReservations(limit = 100) {
  return recordJob("release_expired_reservations", async () => {
    const now = new Date();
    let capacityReleased = 0;
    let discountsReleased = 0;
    let ordersExpired = 0;

    await db.transaction(async (tx) => {
      await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL READ COMMITTED`);

      const capacityRows = await tx.execute<{ id: string; order_id: string }>(sql`
        SELECT id, order_id FROM capacity_reservations
        WHERE status = 'reserved'
          AND expires_at < ${now.toISOString()}::timestamptz
        ORDER BY expires_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      `);
      const capacityList = capacityRows as unknown as Array<{
        id: string;
        order_id: string;
      }>;

      const orderIds = new Set<string>();
      for (const row of capacityList) orderIds.add(row.order_id);

      const discountRows = await tx.execute<{ id: string; order_id: string }>(sql`
        SELECT id, order_id FROM discount_reservations
        WHERE status = 'reserved'
          AND expires_at < ${now.toISOString()}::timestamptz
        ORDER BY expires_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      `);
      const discountList = discountRows as unknown as Array<{
        id: string;
        order_id: string;
      }>;
      for (const row of discountList) orderIds.add(row.order_id);

      for (const orderId of orderIds) {
        const order = await tx.query.orders.findFirst({
          where: eq(orders.id, orderId),
        });
        if (!order) continue;

        if (order.status === ORDER_STATUSES.awaitingPayment) {
          const updated = await tx
            .update(orders)
            .set({
              status: ORDER_STATUSES.expired,
              lastStatusNote: "Payment window expired (reservation sweeper)",
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(orders.id, orderId),
                eq(orders.status, ORDER_STATUSES.awaitingPayment),
              ),
            )
            .returning({ id: orders.id });
          if (updated.length > 0) {
            await releaseOrderHolds(tx, orderId, "expired");
            await tx.insert(orderStatusHistory).values({
              id: newId(),
              orderId,
              fromStatus: ORDER_STATUSES.awaitingPayment,
              toStatus: ORDER_STATUSES.expired,
              actorId: null,
              note: "Payment window expired (reservation sweeper)",
            });
            ordersExpired += 1;
            capacityReleased += 1;
            discountsReleased += 1;
          }
          continue;
        }

        // Terminal unpaid / already expired: ensure holds not stuck reserved.
        if (
          order.status === ORDER_STATUSES.expired ||
          order.status === ORDER_STATUSES.cancelled ||
          order.status === ORDER_STATUSES.rejected
        ) {
          const beforeCap = await tx.query.capacityReservations.findMany({
            where: and(
              eq(capacityReservations.orderId, orderId),
              eq(capacityReservations.status, "reserved"),
            ),
          });
          const beforeDisc = await tx.query.discountReservations.findMany({
            where: and(
              eq(discountReservations.orderId, orderId),
              eq(discountReservations.status, "reserved"),
            ),
          });
          if (beforeCap.length || beforeDisc.length) {
            await releaseOrderHolds(tx, orderId, "expired");
            capacityReleased += beforeCap.length;
            discountsReleased += beforeDisc.length;
          }
        }
      }
    });

    return { capacityReleased, discountsReleased, ordersExpired };
  });
}

/** Read provider health rows after optional refresh. */
export async function checkRateProviders() {
  return recordJob("check_rate_providers", async () => {
    const refresh = await refreshMarketRates();
    const rows = await db.query.providerStatuses.findMany();
    const byKey = Object.fromEntries(
      rows.map((r) => [
        r.providerKey,
        {
          isHealthy: r.isHealthy,
          lastError: r.lastError,
          checkedAt: r.updatedAt.toISOString(),
        },
      ]),
    );
    return {
      refresh,
      exchangeRate: byKey[PROVIDER_KEYS.exchangeRate] ?? null,
      cryptoPrice: byKey[PROVIDER_KEYS.cryptoPrice] ?? null,
      providerStatuses: rows.map((r) => ({
        providerKey: r.providerKey,
        isHealthy: r.isHealthy,
        lastError: r.lastError,
      })),
    };
  });
}

/**
 * Full maintenance pass: expire orders → sweep reservations → refresh/check rates.
 * Idempotent. Safe to invoke from one Vercel cron every 5 minutes (Pro).
 */
export async function runMaintenanceJobs(opts?: { orderLimit?: number; reservationLimit?: number }) {
  const expire = await expireUnpaidOrders(opts?.orderLimit ?? 50);
  const reservations = await releaseExpiredReservations(opts?.reservationLimit ?? 100);
  let rates: Awaited<ReturnType<typeof checkRateProviders>> | { error: string };
  try {
    rates = await checkRateProviders();
  } catch (error) {
    const message = error instanceof Error ? error.message : "rate check failed";
    logger.warn("maintenance_rate_check_failed", { message });
    rates = { error: message };
  }
  return { expire, reservations, rates };
}

export async function listProviderHealth() {
  const rows = await db.query.providerStatuses.findMany();
  return rows.map((r) => ({
    providerKey: r.providerKey,
    providerName: r.providerName,
    isHealthy: r.isHealthy,
    lastError: r.lastError,
    updatedAt: r.updatedAt.toISOString(),
  }));
}
