import { and, avg, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { orders, reviews } from "../../db/schema";
import type { AuthUser } from "../../auth/rbac";
import { assertAdmin, assertVerifiedCustomer } from "../../auth/rbac";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";
import { newId } from "../../ids";
import { parseOrThrow, zNonEmpty } from "../../validation/zod";
import { ORDER_STATUSES } from "../../orders/constants";
import { writeAuditLog } from "../audit/write";

const createSchema = z.object({
  orderId: z.string().uuid(),
  productId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(160).optional(),
  body: z.string().trim().max(5000).optional(),
});

export async function createReview(customer: AuthUser, raw: unknown) {
  assertVerifiedCustomer(customer);
  const input = parseOrThrow(createSchema, raw);

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, input.orderId),
    with: { items: true },
  });
  if (!order) throw new NotFoundError("Order not found");
  if (order.userId !== customer.id) throw new NotFoundError("Order not found");
  if (order.status !== ORDER_STATUSES.completed) {
    throw new ValidationError("Only completed/delivered orders can be reviewed");
  }
  const hasProduct = order.items.some((i) => i.productId === input.productId);
  if (!hasProduct) throw new ValidationError("Product not on this order");

  const existing = await db.query.reviews.findFirst({
    where: and(
      eq(reviews.orderId, input.orderId),
      eq(reviews.userId, customer.id),
      eq(reviews.productId, input.productId),
    ),
  });
  if (existing) throw new ConflictError("Review already submitted");

  const id = newId();
  await db.insert(reviews).values({
    id,
    orderId: input.orderId,
    productId: input.productId,
    userId: customer.id,
    rating: input.rating,
    title: input.title ?? null,
    body: input.body ?? null,
    moderation: "pending",
  });

  return { id, moderation: "pending" as const };
}

const moderateSchema = z.object({
  moderation: z.enum(["approved", "rejected", "pending"]),
  note: zNonEmpty.max(500).optional(),
});

export async function moderateReview(actor: AuthUser, reviewId: string, raw: unknown) {
  assertAdmin(actor);
  const input = parseOrThrow(moderateSchema, raw);
  const review = await db.query.reviews.findFirst({ where: eq(reviews.id, reviewId) });
  if (!review) throw new NotFoundError("Review not found");

  await db
    .update(reviews)
    .set({ moderation: input.moderation })
    .where(eq(reviews.id, reviewId));

  await writeAuditLog({
    actorId: actor.id,
    action: "review.moderate",
    entityType: "review",
    entityId: reviewId,
    before: { moderation: review.moderation },
    after: { moderation: input.moderation, note: input.note ?? null },
  });

  return { id: reviewId, moderation: input.moderation };
}

export async function listPendingReviews(actor: AuthUser) {
  assertAdmin(actor);
  const rows = await db.query.reviews.findMany({
    where: eq(reviews.moderation, "pending"),
    orderBy: [desc(reviews.createdAt)],
    with: { product: true, user: true },
  });
  return rows.map((r) => ({
    id: r.id,
    rating: r.rating,
    title: r.title,
    body: r.body,
    productId: r.productId,
    productTitle: r.product?.title ?? null,
    userId: r.userId,
    username: r.user?.username ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function listApprovedProductReviews(productId: string) {
  const rows = await db.query.reviews.findMany({
    where: and(eq(reviews.productId, productId), eq(reviews.moderation, "approved")),
    orderBy: [desc(reviews.createdAt)],
  });
  return rows.map((r) => ({
    id: r.id,
    rating: r.rating,
    title: r.title,
    body: r.body,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function getProductAverageRating(productId: string) {
  const rows = await db
    .select({
      average: avg(reviews.rating),
      count: count(),
    })
    .from(reviews)
    .where(and(eq(reviews.productId, productId), eq(reviews.moderation, "approved")));
  const average = rows[0]?.average ? Number(rows[0].average) : null;
  return {
    productId,
    averageRating: average,
    approvedCount: Number(rows[0]?.count ?? 0),
  };
}

/** Used by catalog mappers / public product detail. */
export async function getApprovedRatingsMap(productIds: string[]) {
  if (productIds.length === 0) return new Map<string, { average: number; count: number }>();
  const map = new Map<string, { average: number; count: number }>();
  for (const id of productIds) {
    const rating = await getProductAverageRating(id);
    if (rating.approvedCount > 0 && rating.averageRating !== null) {
      map.set(id, { average: rating.averageRating, count: rating.approvedCount });
    }
  }
  return map;
}
