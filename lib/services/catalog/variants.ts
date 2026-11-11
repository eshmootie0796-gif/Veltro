import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { auditLogs, products, productVariants } from "../../db/schema";
import { assertAdmin, type AuthUser } from "../../auth/rbac";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";
import { newId } from "../../ids";
import { parseOrThrow, zNonEmpty, zToman } from "../../validation/zod";
import { mapVariant } from "./mappers";

const capacitySchema = z.discriminatedUnion("capacityMode", [
  z.object({
    capacityMode: z.literal("unlimited"),
    capacityTotal: z.null().optional(),
    capacityRemaining: z.null().optional(),
  }),
  z.object({
    capacityMode: z.literal("finite"),
    capacityTotal: z.number().int().nonnegative(),
    capacityRemaining: z.number().int().nonnegative().optional(),
  }),
]);

export const upsertVariantSchema = z
  .object({
    sku: z.string().trim().min(1).max(80).optional().nullable(),
    name: zNonEmpty.max(160),
    label: z.string().max(160).optional().nullable(),
    labelFa: z.string().max(160).optional().nullable(),
    priceToman: zToman,
    sortOrder: z.number().int().default(0),
    isActive: z.boolean().default(true),
  })
  .and(capacitySchema);

async function requireProduct(productId: string) {
  const product = await db.query.products.findFirst({ where: eq(products.id, productId) });
  if (!product || product.deletedAt) throw new NotFoundError("Product not found");
  return product;
}

export async function listVariants(productId: string) {
  await requireProduct(productId);
  const rows = await db.query.productVariants.findMany({
    where: and(eq(productVariants.productId, productId), isNull(productVariants.deletedAt)),
  });
  return rows.map(mapVariant);
}

export async function createVariant(actor: AuthUser, productId: string, raw: unknown) {
  assertAdmin(actor);
  await requireProduct(productId);
  const input = parseOrThrow(upsertVariantSchema, raw);

  if (input.capacityMode === "finite") {
    const remaining = input.capacityRemaining ?? input.capacityTotal;
    if (remaining > input.capacityTotal) {
      throw new ValidationError("capacityRemaining cannot exceed capacityTotal");
    }
  }

  if (input.sku) {
    const taken = await db.query.productVariants.findFirst({
      where: eq(productVariants.sku, input.sku),
    });
    if (taken) throw new ConflictError("Variant SKU already exists");
  }

  const id = newId();
  await db.insert(productVariants).values({
    id,
    productId,
    sku: input.sku ?? null,
    name: input.name,
    label: input.label ?? null,
    labelFa: input.labelFa ?? null,
    priceToman: input.priceToman,
    capacityMode: input.capacityMode,
    capacityTotal: input.capacityMode === "finite" ? input.capacityTotal : null,
    capacityRemaining:
      input.capacityMode === "finite" ? (input.capacityRemaining ?? input.capacityTotal) : null,
    sortOrder: input.sortOrder,
    isActive: input.isActive,
  });

  await db.insert(auditLogs).values({
    id: newId(),
    actorId: actor.id,
    action: "product_variant.create",
    entityType: "product_variant",
    entityId: id,
    after: { productId, name: input.name, priceToman: input.priceToman },
  });

  const row = await db.query.productVariants.findFirst({ where: eq(productVariants.id, id) });
  return mapVariant(row!);
}

const updateVariantSchema = z.object({
  sku: z.string().trim().min(1).max(80).optional().nullable(),
  name: zNonEmpty.max(160).optional(),
  label: z.string().max(160).optional().nullable(),
  labelFa: z.string().max(160).optional().nullable(),
  priceToman: zToman.optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  capacityMode: z.enum(["unlimited", "finite"]).optional(),
  capacityTotal: z.number().int().nonnegative().optional(),
  capacityRemaining: z.number().int().nonnegative().optional(),
});

export async function updateVariant(actor: AuthUser, variantId: string, raw: unknown) {
  assertAdmin(actor);
  const existing = await db.query.productVariants.findFirst({
    where: eq(productVariants.id, variantId),
  });
  if (!existing || existing.deletedAt) throw new NotFoundError("Variant not found");

  const input = parseOrThrow(updateVariantSchema, raw);

  if (input.sku) {
    const taken = await db.query.productVariants.findFirst({
      where: eq(productVariants.sku, input.sku),
    });
    if (taken && taken.id !== variantId) throw new ConflictError("Variant SKU already exists");
  }

  const capacityMode = input.capacityMode ?? existing.capacityMode;
  let capacityTotal = existing.capacityTotal;
  let capacityRemaining = existing.capacityRemaining;

  if (capacityMode === "unlimited") {
    capacityTotal = null;
    capacityRemaining = null;
  } else {
    capacityTotal = input.capacityTotal ?? existing.capacityTotal ?? 0;
    capacityRemaining =
      input.capacityRemaining ?? existing.capacityRemaining ?? capacityTotal;
    if (capacityRemaining > capacityTotal) {
      throw new ValidationError("capacityRemaining cannot exceed capacityTotal");
    }
  }

  await db
    .update(productVariants)
    .set({
      ...(input.sku !== undefined ? { sku: input.sku } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.labelFa !== undefined ? { labelFa: input.labelFa } : {}),
      ...(input.priceToman !== undefined ? { priceToman: input.priceToman } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      capacityMode,
      capacityTotal,
      capacityRemaining,
      updatedAt: new Date(),
    })
    .where(eq(productVariants.id, variantId));

  await db.insert(auditLogs).values({
    id: newId(),
    actorId: actor.id,
    action: "product_variant.update",
    entityType: "product_variant",
    entityId: variantId,
    after: input as Record<string, unknown>,
  });

  const row = await db.query.productVariants.findFirst({ where: eq(productVariants.id, variantId) });
  return mapVariant(row!);
}

export async function deleteVariant(actor: AuthUser, variantId: string) {
  assertAdmin(actor);
  const existing = await db.query.productVariants.findFirst({
    where: eq(productVariants.id, variantId),
  });
  if (!existing || existing.deletedAt) throw new NotFoundError("Variant not found");

  await db
    .update(productVariants)
    .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(productVariants.id, variantId));

  await db.insert(auditLogs).values({
    id: newId(),
    actorId: actor.id,
    action: "product_variant.soft_delete",
    entityType: "product_variant",
    entityId: variantId,
  });

  return { deleted: true as const };
}
