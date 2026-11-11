import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { auditLogs, productConfigs, products } from "../../db/schema";
import { assertAdmin, type AuthUser } from "../../auth/rbac";
import { NotFoundError } from "../../errors";
import { newId } from "../../ids";
import { parseOrThrow, zToman } from "../../validation/zod";

export const productPricingConfigSchema = z.object({
  serviceFeeBps: z.number().int().min(0).max(10000).optional(),
  fixedAncillaryCostToman: zToman.optional(),
  minOrderAmountToman: zToman.nullable().optional(),
  maxOrderAmountToman: zToman.nullable().optional(),
  allowedCurrencies: z.array(z.string().trim().toUpperCase().min(3).max(10)).optional(),
  /** Merged into product_configs.config */
  pricingSettings: z.record(z.unknown()).optional(),
});

/**
 * Admin updates fee %, fixed costs, min/max, allowed currencies on a product.
 */
export async function updateProductPricingConfig(
  actor: AuthUser,
  productId: string,
  raw: unknown,
) {
  assertAdmin(actor);
  const input = parseOrThrow(productPricingConfigSchema, raw);

  const product = await db.query.products.findFirst({
    where: eq(products.id, productId),
    with: { config: true },
  });
  if (!product || product.deletedAt) throw new NotFoundError("Product not found");

  const nextConfig = {
    ...(product.config?.config ?? {}),
    ...(input.pricingSettings ?? {}),
    ...(input.allowedCurrencies
      ? { allowedCurrencies: input.allowedCurrencies, currencies: input.allowedCurrencies }
      : {}),
  };

  await db.transaction(async (tx) => {
    await tx
      .update(products)
      .set({
        ...(input.serviceFeeBps !== undefined ? { serviceFeeBps: input.serviceFeeBps } : {}),
        ...(input.fixedAncillaryCostToman !== undefined
          ? { fixedAncillaryCostToman: input.fixedAncillaryCostToman }
          : {}),
        ...(input.minOrderAmountToman !== undefined
          ? { minOrderAmountToman: input.minOrderAmountToman }
          : {}),
        ...(input.maxOrderAmountToman !== undefined
          ? { maxOrderAmountToman: input.maxOrderAmountToman }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(products.id, productId));

    if (product.config) {
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

    await tx.insert(auditLogs).values({
      id: newId(),
      actorId: actor.id,
      action: "product.pricing_config",
      entityType: "product",
      entityId: productId,
      after: input as Record<string, unknown>,
    });
  });

  return { productId, updated: true as const };
}
