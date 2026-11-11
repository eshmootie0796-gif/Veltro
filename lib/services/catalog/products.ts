import { and, asc, count, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  auditLogs,
  categories,
  orderItems,
  productConfigs,
  productFieldDefinitions,
  products,
  productVariants,
} from "../../db/schema";
import { CATEGORY_SLUGS } from "../../catalog/constants";
import { defaultFieldsForCategory, parseCategoryConfig } from "../../catalog/category-configs";
import { fieldDefinitionInputSchema } from "../../catalog/field-validation";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { newId } from "../../ids";
import { parseOrThrow, zNonEmpty, zToman } from "../../validation/zod";
import { withTransaction } from "../../db/transaction";
import type { AuthUser } from "../../auth/rbac";
import { assertAdmin } from "../../auth/rbac";
import { mapProduct } from "./mappers";
import {
  buildPaginationMeta,
  combineFilters,
  paginationOffset,
  parseListQuery,
} from "../../query/pagination";

const productImageSchema = z.object({
  url: z.string().url(),
  alt: z.string().max(200).optional(),
  sortOrder: z.number().int().optional(),
});

export const createProductSchema = z.object({
  categorySlug: z.string().min(1),
  type: z.enum(["product", "service"]).default("product"),
  title: zNonEmpty.max(200),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().max(10_000).optional(),
  imageUrl: z.string().url().optional().nullable(),
  images: z.array(productImageSchema).default([]),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
  minOrderAmountToman: zToman.optional().nullable(),
  maxOrderAmountToman: zToman.optional().nullable(),
  fixedAncillaryCostToman: zToman.default(0),
  serviceFeeBps: z.number().int().min(0).max(10000).default(0),
  config: z.record(z.unknown()).default({}),
  fields: z.array(fieldDefinitionInputSchema).optional(),
});

export const updateProductSchema = createProductSchema
  .omit({ categorySlug: true, slug: true })
  .partial()
  .extend({
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(2)
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
  });

async function loadProductBundle(productId: string) {
  const row = await db.query.products.findFirst({
    where: eq(products.id, productId),
    with: {
      category: true,
      variants: true,
      fieldDefinitions: true,
      config: true,
    },
  });
  if (!row || row.deletedAt) throw new NotFoundError("Product not found");
  return row;
}

export async function getPublicProductBySlug(slug: string) {
  const row = await db.query.products.findFirst({
    where: and(eq(products.slug, slug), eq(products.isActive, true), isNull(products.deletedAt)),
    with: {
      category: true,
      variants: true,
      fieldDefinitions: true,
      config: true,
    },
  });
  if (!row || !row.category?.isActive) throw new NotFoundError("Product not found");
  return mapProduct(row, {
    category: row.category,
    variants: row.variants.filter((v) => v.isActive && !v.deletedAt),
    fields: row.fieldDefinitions,
    config: row.config,
  });
}

export async function listPublicProducts(rawQuery: unknown) {
  const query = parseListQuery(rawQuery);
  const categorySlug =
    typeof (rawQuery as { category?: string }).category === "string"
      ? (rawQuery as { category: string }).category
      : undefined;

  let categoryId: string | undefined;
  if (categorySlug) {
    const category = await db.query.categories.findFirst({
      where: and(eq(categories.slug, categorySlug), eq(categories.isActive, true)),
    });
    if (!category) throw new NotFoundError("Category not found");
    categoryId = category.id;
  }

  const where = combineFilters(
    eq(products.isActive, true),
    isNull(products.deletedAt),
    categoryId ? eq(products.categoryId, categoryId) : undefined,
  );

  const totalRow = await db.select({ value: count() }).from(products).where(where);
  const total = Number(totalRow[0]?.value ?? 0);

  const rows = await db.query.products.findMany({
    where,
    orderBy: [asc(products.sortOrder), asc(products.title)],
    limit: query.pageSize,
    offset: paginationOffset(query.page, query.pageSize),
    with: {
      category: true,
      variants: true,
      fieldDefinitions: true,
      config: true,
    },
  });

  return {
    items: rows.map((row) =>
      mapProduct(row, {
        category: row.category,
        variants: row.variants.filter((v) => v.isActive && !v.deletedAt),
        fields: row.fieldDefinitions,
        config: row.config,
      }),
    ),
    meta: buildPaginationMeta(total, query.page, query.pageSize),
  };
}

export async function createProduct(actor: AuthUser, raw: unknown) {
  assertAdmin(actor);
  const input = parseOrThrow(createProductSchema, raw);

  if (
    input.categorySlug === CATEGORY_SLUGS.aiSubscriptions ||
    input.categorySlug === CATEGORY_SLUGS.paypalServices
  ) {
    throw new ForbiddenError(
      "AI and PayPal catalog items are predefined and cannot be created arbitrarily",
    );
  }

  const category = await db.query.categories.findFirst({
    where: eq(categories.slug, input.categorySlug),
  });
  if (!category) throw new NotFoundError("Category not found");

  const slugTaken = await db.query.products.findFirst({ where: eq(products.slug, input.slug) });
  if (slugTaken && !slugTaken.deletedAt) throw new ConflictError("Product slug already exists");

  const config = parseCategoryConfig(category.slug, input.config);
  const fields = input.fields ?? defaultFieldsForCategory(category.slug);

  const created = await withTransaction(async (tx) => {
    const id = newId();
    await tx.insert(products).values({
      id,
      categoryId: category.id,
      type: input.type,
      title: input.title,
      slug: input.slug,
      description: input.description,
      imageUrl: input.imageUrl ?? null,
      images: input.images,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
      minOrderAmountToman: input.minOrderAmountToman ?? null,
      maxOrderAmountToman: input.maxOrderAmountToman ?? null,
      fixedAncillaryCostToman: input.fixedAncillaryCostToman,
      serviceFeeBps: input.serviceFeeBps,
      isCatalogLocked: false,
    });

    await tx.insert(productConfigs).values({
      id: newId(),
      productId: id,
      config,
    });

    for (const field of fields) {
      const parsed = parseOrThrow(fieldDefinitionInputSchema, field);
      if (
        (parsed.fieldType === "select" || parsed.fieldType === "multi_select") &&
        parsed.options.length === 0
      ) {
        throw new ValidationError("Select fields require options");
      }
      await tx.insert(productFieldDefinitions).values({
        id: newId(),
        productId: id,
        key: parsed.key,
        labelEn: parsed.labelEn,
        labelFa: parsed.labelFa,
        fieldType: parsed.fieldType,
        options: parsed.options,
        isRequired: parsed.isRequired,
        sortOrder: parsed.sortOrder,
        validation: parsed.validation,
        visibility: parsed.visibility ?? null,
      });
    }

    await tx.insert(auditLogs).values({
      id: newId(),
      actorId: actor.id,
      action: "product.create",
      entityType: "product",
      entityId: id,
      after: { slug: input.slug, category: category.slug },
    });

    return id;
  });

  const bundle = await loadProductBundle(created);
  return mapProduct(bundle, {
    category: bundle.category,
    variants: bundle.variants,
    fields: bundle.fieldDefinitions,
    config: bundle.config,
  });
}

export async function updateProduct(actor: AuthUser, productId: string, raw: unknown) {
  assertAdmin(actor);
  const input = parseOrThrow(updateProductSchema, raw);
  const existing = await loadProductBundle(productId);

  if (input.slug && input.slug !== existing.slug) {
    const taken = await db.query.products.findFirst({
      where: and(eq(products.slug, input.slug), ne(products.id, productId)),
    });
    if (taken && !taken.deletedAt) throw new ConflictError("Product slug already exists");
  }

  let nextConfig = existing.config?.config ?? {};
  if (input.config) {
    nextConfig = parseCategoryConfig(existing.category!.slug, input.config);
  }

  await withTransaction(async (tx) => {
    await tx
      .update(products)
      .set({
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
        ...(input.images !== undefined ? { images: input.images } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.minOrderAmountToman !== undefined
          ? { minOrderAmountToman: input.minOrderAmountToman }
          : {}),
        ...(input.maxOrderAmountToman !== undefined
          ? { maxOrderAmountToman: input.maxOrderAmountToman }
          : {}),
        ...(input.fixedAncillaryCostToman !== undefined
          ? { fixedAncillaryCostToman: input.fixedAncillaryCostToman }
          : {}),
        ...(input.serviceFeeBps !== undefined ? { serviceFeeBps: input.serviceFeeBps } : {}),
        updatedAt: new Date(),
      })
      .where(eq(products.id, productId));

    if (input.config) {
      if (existing.config) {
        await tx
          .update(productConfigs)
          .set({ config: nextConfig, updatedAt: new Date() })
          .where(eq(productConfigs.productId, productId));
      } else {
        await tx.insert(productConfigs).values({
          id: newId(),
          productId,
          config: nextConfig,
        });
      }
    }

    await tx.insert(auditLogs).values({
      id: newId(),
      actorId: actor.id,
      action: "product.update",
      entityType: "product",
      entityId: productId,
      after: input as Record<string, unknown>,
    });
  });

  const bundle = await loadProductBundle(productId);
  return mapProduct(bundle, {
    category: bundle.category,
    variants: bundle.variants,
    fields: bundle.fieldDefinitions,
    config: bundle.config,
  });
}

export async function setProductActive(actor: AuthUser, productId: string, isActive: boolean) {
  assertAdmin(actor);
  const existing = await loadProductBundle(productId);
  await db
    .update(products)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(products.id, existing.id));
  return { id: existing.id, isActive };
}

export async function deleteProduct(actor: AuthUser, productId: string) {
  assertAdmin(actor);
  const existing = await loadProductBundle(productId);

  if (existing.isCatalogLocked) {
    await db
      .update(products)
      .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(products.id, productId));
    await db.insert(auditLogs).values({
      id: newId(),
      actorId: actor.id,
      action: "product.soft_delete_locked",
      entityType: "product",
      entityId: productId,
    });
    return { deleted: true as const, mode: "soft" as const };
  }

  const refs = await db
    .select({ value: count() })
    .from(orderItems)
    .where(eq(orderItems.productId, productId));
  const refCount = Number(refs[0]?.value ?? 0);

  if (refCount > 0) {
    await db
      .update(products)
      .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(products.id, productId));
    await db.insert(auditLogs).values({
      id: newId(),
      actorId: actor.id,
      action: "product.soft_delete",
      entityType: "product",
      entityId: productId,
      after: { reason: "historical_orders" },
    });
    return { deleted: true as const, mode: "soft" as const };
  }

  await withTransaction(async (tx) => {
    await tx.delete(productFieldDefinitions).where(eq(productFieldDefinitions.productId, productId));
    await tx.delete(productConfigs).where(eq(productConfigs.productId, productId));
    await tx.delete(productVariants).where(eq(productVariants.productId, productId));
    await tx.delete(products).where(eq(products.id, productId));
    await tx.insert(auditLogs).values({
      id: newId(),
      actorId: actor.id,
      action: "product.hard_delete",
      entityType: "product",
      entityId: productId,
    });
  });

  return { deleted: true as const, mode: "hard" as const };
}

export async function getAdminProduct(productId: string) {
  const bundle = await loadProductBundle(productId);
  return mapProduct(bundle, {
    category: bundle.category,
    variants: bundle.variants,
    fields: bundle.fieldDefinitions,
    config: bundle.config,
  });
}
