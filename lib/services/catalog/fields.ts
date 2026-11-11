import { eq } from "drizzle-orm";
import { db } from "../../db";
import { auditLogs, productFieldDefinitions, products } from "../../db/schema";
import { assertAdmin, type AuthUser } from "../../auth/rbac";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";
import { newId } from "../../ids";
import { parseOrThrow } from "../../validation/zod";
import {
  fieldDefinitionInputSchema,
  validateDynamicFieldValues,
  type FieldDefinitionRecord,
} from "../../catalog/field-validation";
import { mapField } from "./mappers";

async function requireProduct(productId: string) {
  const product = await db.query.products.findFirst({ where: eq(products.id, productId) });
  if (!product || product.deletedAt) throw new NotFoundError("Product not found");
  return product;
}

export async function listFields(productId: string) {
  await requireProduct(productId);
  const rows = await db.query.productFieldDefinitions.findMany({
    where: eq(productFieldDefinitions.productId, productId),
  });
  return rows.map(mapField);
}

export async function replaceFields(actor: AuthUser, productId: string, raw: unknown) {
  assertAdmin(actor);
  await requireProduct(productId);

  const parsed = parseOrThrow(fieldDefinitionInputSchema.array(), raw);
  const keys = new Set<string>();
  for (const field of parsed) {
    if (keys.has(field.key)) throw new ConflictError(`Duplicate field key: ${field.key}`);
    keys.add(field.key);
    if (
      (field.fieldType === "select" || field.fieldType === "multi_select") &&
      field.options.length === 0
    ) {
      throw new ValidationError(`Select field ${field.key} requires options`);
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(productFieldDefinitions)
      .where(eq(productFieldDefinitions.productId, productId));
    for (const field of parsed) {
      await tx.insert(productFieldDefinitions).values({
        id: newId(),
        productId,
        key: field.key,
        labelEn: field.labelEn,
        labelFa: field.labelFa,
        fieldType: field.fieldType,
        options: field.options,
        isRequired: field.isRequired,
        sortOrder: field.sortOrder,
        validation: field.validation,
        visibility: field.visibility ?? null,
      });
    }
    await tx.insert(auditLogs).values({
      id: newId(),
      actorId: actor.id,
      action: "product_fields.replace",
      entityType: "product",
      entityId: productId,
      after: { count: parsed.length },
    });
  });

  return listFields(productId);
}

/**
 * Validate customer-submitted dynamic fields for a product (order module will call this).
 */
export async function validateProductFieldValues(
  productId: string,
  values: Record<string, unknown>,
) {
  const product = await requireProduct(productId);
  if (!product.isActive) throw new ValidationError("Product is inactive");

  const rows = await db.query.productFieldDefinitions.findMany({
    where: eq(productFieldDefinitions.productId, productId),
  });

  const definitions: FieldDefinitionRecord[] = rows.map((row) => ({
    key: row.key,
    labelEn: row.labelEn,
    labelFa: row.labelFa,
    fieldType: row.fieldType,
    options: row.options ?? [],
    isRequired: row.isRequired,
    validation: row.validation ?? {},
    visibility: row.visibility ?? null,
  }));

  return validateDynamicFieldValues(definitions, values);
}
