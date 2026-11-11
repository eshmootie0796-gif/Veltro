import { and, eq, inArray } from "drizzle-orm";
import type { DbTransaction } from "../../db/transaction";
import { lockVariantForUpdate } from "../../db/transaction";
import { capacityReservations, productVariants } from "../../db/schema";
import {
  releaseDiscountReservation,
  revokeDiscountUsageForOrder,
} from "../discounts/service";

async function restoreCapacityHolds(
  tx: DbTransaction,
  orderId: string,
  fromStatuses: Array<"reserved" | "consumed">,
  nextStatus: "released" | "expired",
) {
  const holds = await tx.query.capacityReservations.findMany({
    where: and(
      eq(capacityReservations.orderId, orderId),
      inArray(capacityReservations.status, fromStatuses),
    ),
  });

  for (const hold of holds) {
    await lockVariantForUpdate(tx, hold.variantId);
    const variant = await tx.query.productVariants.findFirst({
      where: eq(productVariants.id, hold.variantId),
    });
    if (variant && variant.capacityMode === "finite") {
      const remaining = (variant.capacityRemaining ?? 0) + hold.quantity;
      const capped =
        variant.capacityTotal !== null ? Math.min(remaining, variant.capacityTotal) : remaining;
      await tx
        .update(productVariants)
        .set({ capacityRemaining: capped, updatedAt: new Date() })
        .where(eq(productVariants.id, variant.id));
    }
    await tx
      .update(capacityReservations)
      .set({ status: nextStatus, updatedAt: new Date() })
      .where(eq(capacityReservations.id, hold.id));
  }
}

export async function releaseCapacityForOrder(
  tx: DbTransaction,
  orderId: string,
  nextStatus: "released" | "expired",
) {
  await restoreCapacityHolds(tx, orderId, ["reserved"], nextStatus);
}

/** Restore inventory after admin cancel/reject of a paid (pre-delivery) order. */
export async function restoreConsumedCapacityForOrder(
  tx: DbTransaction,
  orderId: string,
) {
  await restoreCapacityHolds(tx, orderId, ["consumed"], "released");
}

export async function releaseOrderHolds(
  tx: DbTransaction,
  orderId: string,
  kind: "released" | "expired",
) {
  await releaseCapacityForOrder(tx, orderId, kind);
  await releaseDiscountReservation(tx, orderId, kind);
}

export async function releasePaidOrderResources(tx: DbTransaction, orderId: string) {
  await restoreConsumedCapacityForOrder(tx, orderId);
  await revokeDiscountUsageForOrder(tx, orderId);
}

export async function consumeCapacityForOrder(tx: DbTransaction, orderId: string) {
  const holds = await tx.query.capacityReservations.findMany({
    where: and(
      eq(capacityReservations.orderId, orderId),
      eq(capacityReservations.status, "reserved"),
    ),
  });
  for (const hold of holds) {
    await tx
      .update(capacityReservations)
      .set({ status: "consumed", updatedAt: new Date() })
      .where(eq(capacityReservations.id, hold.id));
  }
}
