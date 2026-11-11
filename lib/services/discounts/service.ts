import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  discountReservations,
  discounts,
  discountUsages,
  notifications,
  roles,
  users,
} from "../../db/schema";
import type { DbTransaction } from "../../db/transaction";
import { lockDiscountForUpdate } from "../../db/transaction";
import { assertAdmin, type AuthUser } from "../../auth/rbac";
import { CapacityExceededError, ConflictError, NotFoundError, ValidationError } from "../../errors";
import { newId } from "../../ids";
import { parseOrThrow, zNonEmpty, zToman } from "../../validation/zod";
import { applyBps, toTomanInt } from "../../money/decimal";
import { NOTIFICATION_TYPES } from "../../notifications/constants";
import { writeAuditLog } from "../audit/write";

export const createDiscountSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(3)
    .max(40)
    .regex(/^[A-Z0-9_-]+$/),
  name: zNonEmpty.max(120),
  type: z.enum(["fixed", "percentage"]),
  fixedAmountToman: zToman.optional().nullable(),
  percentageBps: z.number().int().min(1).max(10000).optional().nullable(),
  maxDiscountToman: zToman.optional().nullable(),
  validFrom: z.coerce.date().optional().nullable(),
  validUntil: z.coerce.date().optional().nullable(),
  usageLimit: z.number().int().positive().optional().nullable(),
  perUserLimit: z.number().int().positive().optional().nullable(),
  minOrderAmountToman: zToman.optional().nullable(),
  scopeType: z.enum(["all", "category", "product"]).default("all"),
  scopeIds: z.array(z.string().min(1)).default([]),
  isActive: z.boolean().default(true),
  announce: z.boolean().default(true),
});

export async function createDiscount(actor: AuthUser, raw: unknown) {
  assertAdmin(actor);
  const input = parseOrThrow(createDiscountSchema, raw);

  if (input.type === "fixed" && (input.fixedAmountToman === undefined || input.fixedAmountToman === null)) {
    throw new ValidationError("fixedAmountToman required for fixed discounts");
  }
  if (input.type === "percentage" && (input.percentageBps === undefined || input.percentageBps === null)) {
    throw new ValidationError("percentageBps required for percentage discounts");
  }
  if (input.scopeType !== "all" && input.scopeIds.length === 0) {
    throw new ValidationError("scopeIds required for scoped discounts");
  }

  const existing = await db.query.discounts.findFirst({
    where: eq(discounts.code, input.code),
  });
  if (existing) throw new ConflictError("Discount code already exists");

  const id = newId();
  await db.insert(discounts).values({
    id,
    code: input.code,
    name: input.name,
    type: input.type,
    fixedAmountToman: input.fixedAmountToman ?? null,
    percentageBps: input.percentageBps ?? null,
    maxDiscountToman: input.maxDiscountToman ?? null,
    validFrom: input.validFrom ?? null,
    validUntil: input.validUntil ?? null,
    usageLimit: input.usageLimit ?? null,
    perUserLimit: input.perUserLimit ?? null,
    minOrderAmountToman: input.minOrderAmountToman ?? null,
    scopeType: input.scopeType,
    scopeIds: input.scopeIds,
    isActive: input.isActive,
  });

  await writeAuditLog({
    actorId: actor.id,
    action: "discount.create",
    entityType: "discount",
    entityId: id,
    after: {
      code: input.code,
      name: input.name,
      type: input.type,
      isActive: input.isActive,
    },
  });

  if (input.announce && input.isActive) {
    await announceDiscountToCustomers(id, input.code, input.name);
  }

  return { id, code: input.code };
}

async function announceDiscountToCustomers(discountId: string, code: string, name: string) {
  const customerRole = await db.query.roles.findFirst({ where: eq(roles.slug, "customer") });
  if (!customerRole) return;
  const customers = await db.query.users.findMany({
    where: and(eq(users.roleId, customerRole.id), eq(users.status, "active")),
  });
  if (customers.length === 0) return;

  // Chunk inserts to avoid huge single statements
  const chunkSize = 200;
  for (let i = 0; i < customers.length; i += chunkSize) {
    const slice = customers.slice(i, i + chunkSize);
    await db.insert(notifications).values(
      slice.map((u) => ({
        id: newId(),
        userId: u.id,
        type: NOTIFICATION_TYPES.discount,
        title: `New discount: ${code}`,
        body: `${name} is now available. Code: ${code}`,
        data: { discountId, code, name },
      })),
    );
  }
}

export function computeDiscountAmount(input: {
  type: string;
  fixedAmountToman: number | null;
  percentageBps: number | null;
  maxDiscountToman: number | null;
  amountBeforeDiscount: number;
}): number {
  let discount = 0;
  if (input.type === "fixed") {
    discount = input.fixedAmountToman ?? 0;
  } else {
    discount = toTomanInt(applyBps(input.amountBeforeDiscount, input.percentageBps ?? 0));
    if (input.maxDiscountToman !== null && input.maxDiscountToman !== undefined) {
      discount = Math.min(discount, input.maxDiscountToman);
    }
  }
  discount = Math.min(discount, input.amountBeforeDiscount);
  return Math.max(0, discount);
}

/**
 * Lock discount row, enforce limits/scope, compute amount.
 * Insert order first, then call insertDiscountReservation (FK).
 */
export async function quoteAndLockDiscount(
  tx: DbTransaction,
  input: {
    code: string;
    userId: string;
    productId: string;
    categoryId: string;
    amountBeforeDiscount: number;
  },
) {
  const discount = await tx.query.discounts.findFirst({
    where: eq(discounts.code, input.code.toUpperCase()),
  });
  if (!discount || !discount.isActive) {
    throw new ValidationError("Invalid discount code");
  }

  await lockDiscountForUpdate(tx, discount.id);

  const now = new Date();
  if (discount.validFrom && discount.validFrom > now) {
    throw new ValidationError("Discount is not active yet");
  }
  if (discount.validUntil && discount.validUntil < now) {
    throw new ValidationError("Discount has expired");
  }
  if (
    discount.minOrderAmountToman !== null &&
    discount.minOrderAmountToman !== undefined &&
    input.amountBeforeDiscount < discount.minOrderAmountToman
  ) {
    throw new ValidationError("Order amount below discount minimum");
  }

  if (discount.scopeType === "product" && !discount.scopeIds.includes(input.productId)) {
    throw new ValidationError("Discount not valid for this product");
  }
  if (discount.scopeType === "category" && !discount.scopeIds.includes(input.categoryId)) {
    throw new ValidationError("Discount not valid for this category");
  }

  const reservedRows = await tx
    .select({ value: count() })
    .from(discountReservations)
    .where(
      and(
        eq(discountReservations.discountId, discount.id),
        eq(discountReservations.status, "reserved"),
      ),
    );
  const usageRows = await tx
    .select({ value: count() })
    .from(discountUsages)
    .where(eq(discountUsages.discountId, discount.id));

  const reservedCount = Number(reservedRows[0]?.value ?? 0);
  const usedCount = Number(usageRows[0]?.value ?? 0);

  if (discount.usageLimit !== null && reservedCount + usedCount >= discount.usageLimit) {
    throw new CapacityExceededError("Discount usage limit reached");
  }

  if (discount.perUserLimit !== null) {
    const userReservedRows = await tx
      .select({ value: count() })
      .from(discountReservations)
      .where(
        and(
          eq(discountReservations.discountId, discount.id),
          eq(discountReservations.userId, input.userId),
          eq(discountReservations.status, "reserved"),
        ),
      );
    const userUsed = await tx
      .select({ value: count() })
      .from(discountUsages)
      .where(
        and(eq(discountUsages.discountId, discount.id), eq(discountUsages.userId, input.userId)),
      );
    const uRes = Number(userReservedRows[0]?.value ?? 0);
    const uUsed = Number(userUsed[0]?.value ?? 0);
    if (uRes + uUsed >= discount.perUserLimit) {
      throw new CapacityExceededError("Per-user discount limit reached");
    }
  }

  const amountToman = computeDiscountAmount({
    type: discount.type,
    fixedAmountToman: discount.fixedAmountToman,
    percentageBps: discount.percentageBps,
    maxDiscountToman: discount.maxDiscountToman,
    amountBeforeDiscount: input.amountBeforeDiscount,
  });

  return { discount, amountToman };
}

export async function insertDiscountReservation(
  tx: DbTransaction,
  input: {
    discountId: string;
    userId: string;
    orderId: string;
    expiresAt: Date;
  },
) {
  const reservationId = newId();
  await tx.insert(discountReservations).values({
    id: reservationId,
    discountId: input.discountId,
    userId: input.userId,
    orderId: input.orderId,
    status: "reserved",
    expiresAt: input.expiresAt,
  });
  return reservationId;
}

export async function releaseDiscountReservation(
  tx: DbTransaction,
  orderId: string,
  nextStatus: "released" | "expired",
) {
  const row = await tx.query.discountReservations.findFirst({
    where: and(
      eq(discountReservations.orderId, orderId),
      eq(discountReservations.status, "reserved"),
    ),
  });
  if (!row) return;
  await tx
    .update(discountReservations)
    .set({ status: nextStatus, updatedAt: new Date() })
    .where(eq(discountReservations.id, row.id));
}

/** Undo consumed usage so limits free up after paid cancel/reject. */
export async function revokeDiscountUsageForOrder(tx: DbTransaction, orderId: string) {
  const usage = await tx.query.discountUsages.findFirst({
    where: eq(discountUsages.orderId, orderId),
  });
  if (usage) {
    await lockDiscountForUpdate(tx, usage.discountId);
    await tx.delete(discountUsages).where(eq(discountUsages.id, usage.id));
  }

  const reservation = await tx.query.discountReservations.findFirst({
    where: eq(discountReservations.orderId, orderId),
  });
  if (!reservation) return;
  if (reservation.status === "reserved" || reservation.status === "consumed") {
    await tx
      .update(discountReservations)
      .set({ status: "released", updatedAt: new Date() })
      .where(eq(discountReservations.id, reservation.id));
  }
}

export async function consumeDiscountReservation(
  tx: DbTransaction,
  orderId: string,
  userId: string,
  amountToman: number,
) {
  const row = await tx.query.discountReservations.findFirst({
    where: and(
      eq(discountReservations.orderId, orderId),
      eq(discountReservations.status, "reserved"),
    ),
  });
  if (!row) return;
  await lockDiscountForUpdate(tx, row.discountId);
  await tx
    .update(discountReservations)
    .set({ status: "consumed", updatedAt: new Date() })
    .where(eq(discountReservations.id, row.id));
  await tx.insert(discountUsages).values({
    id: newId(),
    discountId: row.discountId,
    userId,
    orderId,
    amountToman,
  });
}

export async function listDiscounts(actor: AuthUser) {
  assertAdmin(actor);
  return db.query.discounts.findMany();
}
