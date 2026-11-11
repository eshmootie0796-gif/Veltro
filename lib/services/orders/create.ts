import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  lockVariantForUpdate,
  withReservationTransaction,
} from "../../db/transaction";
import { db } from "../../db";
import {
  capacityReservations,
  orderItems,
  orders,
  orderStatusHistory,
  productVariants,
} from "../../db/schema";
import { assertVerifiedCustomer, type AuthUser } from "../../auth/rbac";
import { CapacityExceededError, NotFoundError, ValidationError } from "../../errors";
import { newId } from "../../ids";
import { parseOrThrow, zCryptoAmount } from "../../validation/zod";
import { validateProductFieldValues } from "../catalog/fields";
import { ORDER_PAYMENT_TTL_MS, ORDER_STATUSES } from "../../orders/constants";
import { NOTIFICATION_TYPES } from "../../notifications/constants";
import {
  insertDiscountReservation,
  quoteAndLockDiscount,
} from "../discounts/service";
import { notifyUser } from "../notifications/service";
import { resolveCategoryOrder } from "./categories/resolve";

const createOrderSchema = z.object({
  variantId: z.string().uuid(),
  quantity: z.number().int().min(1).max(100).default(1),
  fieldValues: z.record(z.unknown()).default({}),
  discountCode: z.string().trim().toUpperCase().optional(),
  /** Pricing inputs — never includes final payable. Optional hints; category logic decides. */
  pricing: z
    .discriminatedUnion("mode", [
      z.object({
        mode: z.literal("fixed_irt"),
      }),
      z.object({
        mode: z.literal("fx"),
        foreignAmount: zCryptoAmount.optional(),
        foreignCurrency: z.string().trim().toUpperCase().min(3).max(10).optional(),
        shippingForeign: zCryptoAmount.optional(),
        taxForeign: zCryptoAmount.optional(),
        customsForeign: zCryptoAmount.optional(),
      }),
      z.object({
        mode: z.literal("crypto"),
        cryptoAmount: zCryptoAmount.optional(),
        cryptoSymbol: z.string().trim().toUpperCase().min(2).max(16).optional(),
      }),
    ])
    .default({ mode: "fixed_irt" }),
});

export async function createOrder(customer: AuthUser, raw: unknown) {
  assertVerifiedCustomer(customer);
  const input = parseOrThrow(createOrderSchema, raw);

  const variant = await db.query.productVariants.findFirst({
    where: and(eq(productVariants.id, input.variantId), isNull(productVariants.deletedAt)),
    with: {
      product: { with: { category: true, config: true } },
    },
  });
  if (!variant || !variant.isActive) throw new NotFoundError("Variant not found");
  const product = variant.product;
  if (!product || product.deletedAt || !product.isActive) {
    throw new NotFoundError("Product not found");
  }
  if (!product.category?.isActive) throw new NotFoundError("Category inactive");

  const validatedFields = await validateProductFieldValues(product.id, input.fieldValues);

  const resolved = await resolveCategoryOrder({
    categorySlug: product.category!.slug,
    productTitle: product.title,
    catalogKey: product.catalogKey,
    config: product.config?.config ?? {},
    variantName: variant.name,
    variantPriceToman: variant.priceToman,
    serviceFeeBps: product.serviceFeeBps,
    fixedAncillaryCostToman: product.fixedAncillaryCostToman,
    minOrderAmountToman: product.minOrderAmountToman,
    maxOrderAmountToman: product.maxOrderAmountToman,
    quantity: input.quantity,
    fieldValues: validatedFields,
    pricing: input.pricing,
  });

  const snapshot = resolved.snapshot;
  const fieldSnapshot = resolved.fieldValues;

  const beforeDiscount = snapshot.finalToman;
  if (
    product.minOrderAmountToman !== null &&
    product.minOrderAmountToman !== undefined &&
    beforeDiscount < product.minOrderAmountToman
  ) {
    throw new ValidationError("Below minimum order amount");
  }
  if (
    product.maxOrderAmountToman !== null &&
    product.maxOrderAmountToman !== undefined &&
    beforeDiscount > product.maxOrderAmountToman
  ) {
    throw new ValidationError("Above maximum order amount");
  }

  const now = new Date();
  const paymentExpiresAt = new Date(now.getTime() + ORDER_PAYMENT_TTL_MS);
  const orderId = newId();
  const qty = input.quantity;

  const created = await withReservationTransaction(async (tx) => {
    await lockVariantForUpdate(tx, variant.id);
    const locked = await tx.query.productVariants.findFirst({
      where: eq(productVariants.id, variant.id),
    });
    if (!locked || !locked.isActive || locked.deletedAt) {
      throw new NotFoundError("Variant not found");
    }

    if (locked.capacityMode === "finite") {
      const remaining = locked.capacityRemaining ?? 0;
      if (remaining < qty) {
        throw new CapacityExceededError("Product capacity exhausted");
      }
      await tx
        .update(productVariants)
        .set({
          capacityRemaining: remaining - qty,
          updatedAt: new Date(),
        })
        .where(eq(productVariants.id, variant.id));
    }

    let discountToman = 0;
    let discountCodeSnapshot: string | null = null;
    let discountId: string | null = null;
    let quotedDiscount: Awaited<ReturnType<typeof quoteAndLockDiscount>> | null = null;

    if (input.discountCode) {
      quotedDiscount = await quoteAndLockDiscount(tx, {
        code: input.discountCode,
        userId: customer.id,
        productId: product.id,
        categoryId: product.categoryId,
        amountBeforeDiscount: beforeDiscount,
      });
      discountToman = quotedDiscount.amountToman;
      discountCodeSnapshot = quotedDiscount.discount.code;
      discountId = quotedDiscount.discount.id;
    }

    const payable = Math.max(0, beforeDiscount - discountToman);
    const pricingSnapshot = {
      ...snapshot,
      discountToman,
      finalToman: payable,
      amountBeforeDiscount: beforeDiscount,
      pricingValidUntil: paymentExpiresAt.toISOString(),
      fulfillment: resolved.fulfillment,
      categorySlug: product.category!.slug,
    };

    const unitPrice = Math.floor(beforeDiscount / Math.max(qty, 1));
    const lineTotal = beforeDiscount;

    await tx.insert(orders).values({
      id: orderId,
      userId: customer.id,
      status: ORDER_STATUSES.awaitingPayment,
      currencyCode: "IRT",
      subtotalToman: snapshot.baseToman,
      feeToman: snapshot.percentageFeeToman,
      fixedCostToman:
        snapshot.fixedAncillaryCostToman +
        snapshot.shippingToman +
        snapshot.taxToman +
        snapshot.customsToman,
      discountToman,
      exchangeRateUsed: snapshot.exchangeRate,
      exchangeBaseCode: snapshot.originalCurrency,
      exchangeQuoteCode: "IRT",
      payableToman: payable,
      discountCodeSnapshot,
      discountId,
      pricingSnapshot,
      customerInputSnapshot: fieldSnapshot,
      paymentExpiresAt,
    });

    await tx.insert(orderItems).values({
      id: newId(),
      orderId,
      productId: product.id,
      variantId: variant.id,
      productTitleSnap: product.title,
      variantNameSnap: variant.name,
      quantity: qty,
      unitPriceToman: unitPrice,
      lineTotalToman: lineTotal,
      fieldValuesSnap: fieldSnapshot,
    });

    if (quotedDiscount) {
      await insertDiscountReservation(tx, {
        discountId: quotedDiscount.discount.id,
        userId: customer.id,
        orderId,
        expiresAt: paymentExpiresAt,
      });
    }

    if (locked.capacityMode === "finite") {
      await tx.insert(capacityReservations).values({
        id: newId(),
        orderId,
        variantId: variant.id,
        quantity: qty,
        status: "reserved",
        expiresAt: paymentExpiresAt,
      });
    }

    await tx.insert(orderStatusHistory).values({
      id: newId(),
      orderId,
      fromStatus: null,
      toStatus: ORDER_STATUSES.awaitingPayment,
      actorId: customer.id,
      note: "Order created",
    });

    return {
      id: orderId,
      status: ORDER_STATUSES.awaitingPayment,
      payableToman: payable,
      discountToman,
      paymentExpiresAt: paymentExpiresAt.toISOString(),
      pricingSnapshot,
      customerInput: fieldSnapshot,
    };
  });

  await notifyUser({
    userId: customer.id,
    type: NOTIFICATION_TYPES.orderCreated,
    vars: { orderId: created.id },
    data: { orderId: created.id, payableToman: created.payableToman },
  });

  return created;
}
