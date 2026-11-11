import { eq } from "drizzle-orm";
import { db } from "../../db";
import {
  categories,
  productConfigs,
  productFieldDefinitions,
  products,
} from "../../db/schema";
import {
  AI_ACCOUNT_EMAIL_FIELD,
  AI_SERVICE_CATALOG,
  CATEGORY_SLUGS,
  PAYPAL_SERVICE_CATALOG,
} from "../../catalog/constants";
import { newId } from "../../ids";
import { logger } from "../../logger";
import { withTransaction } from "../../db/transaction";

async function requireCategory(slug: string) {
  const category = await db.query.categories.findFirst({ where: eq(categories.slug, slug) });
  if (!category) throw new Error(`Category missing: ${slug}`);
  return category;
}

async function ensureLockedProduct(input: {
  categoryId: string;
  catalogKey: string;
  slug: string;
  title: string;
  description: string;
  config: Record<string, unknown>;
  fields?: Array<{
    key: string;
    labelEn: string;
    labelFa: string;
    fieldType: string;
    isRequired: boolean;
    options?: Array<{ value: string; labelEn: string; labelFa: string }>;
  }>;
}) {
  const existing = await db.query.products.findFirst({
    where: eq(products.catalogKey, input.catalogKey),
  });
  if (existing) return existing.id;

  return withTransaction(async (tx) => {
    const id = newId();
    await tx.insert(products).values({
      id,
      categoryId: input.categoryId,
      type: "service",
      title: input.title,
      slug: input.slug,
      description: input.description,
      images: [],
      sortOrder: 0,
      isActive: true,
      catalogKey: input.catalogKey,
      isCatalogLocked: true,
      fixedAncillaryCostToman: 0,
      serviceFeeBps: 0,
    });

    await tx.insert(productConfigs).values({
      id: newId(),
      productId: id,
      config: input.config,
    });

    for (const [index, field] of (input.fields ?? []).entries()) {
      await tx.insert(productFieldDefinitions).values({
        id: newId(),
        productId: id,
        key: field.key,
        labelEn: field.labelEn,
        labelFa: field.labelFa,
        fieldType: field.fieldType,
        options: field.options ?? [],
        isRequired: field.isRequired,
        sortOrder: index,
        validation: {},
        visibility: null,
      });
    }

    return id;
  });
}

/** Seed predefined AI + PayPal catalog products (idempotent). */
export async function seedLockedCatalog() {
  const aiCategory = await requireCategory(CATEGORY_SLUGS.aiSubscriptions);
  const paypalCategory = await requireCategory(CATEGORY_SLUGS.paypalServices);

  for (const service of AI_SERVICE_CATALOG) {
    await ensureLockedProduct({
      categoryId: aiCategory.id,
      catalogKey: service.catalogKey,
      slug: `ai-${service.slug}`,
      title: service.title,
      description: `Personal-account ${service.title} subscription. Passwords are never collected.`,
      config: {
        group: service.group,
        personalAccountOnly: true,
        neverCollectPassword: true,
        noSharedAccounts: true,
      },
      fields: [
        {
          key: "plan",
          labelEn: "Plan",
          labelFa: "پلن",
          fieldType: "text",
          isRequired: true,
        },
        {
          key: "duration",
          labelEn: "Duration",
          labelFa: "مدت",
          fieldType: "text",
          isRequired: true,
        },
        {
          ...AI_ACCOUNT_EMAIL_FIELD,
          options: [],
        },
        {
          key: "notes",
          labelEn: "Notes",
          labelFa: "توضیحات",
          fieldType: "textarea",
          isRequired: false,
        },
      ],
    });
  }

  for (const service of PAYPAL_SERVICE_CATALOG) {
    const serviceKey =
      service.catalogKey === "paypal.top-up"
        ? "top-up"
        : service.catalogKey === "paypal.send-money"
          ? "send-money"
          : "receive-money";

    await ensureLockedProduct({
      categoryId: paypalCategory.id,
      catalogKey: service.catalogKey,
      slug: service.slug,
      title: service.title,
      description: service.title,
      config: {
        service: serviceKey,
        currencies: ["USD", "EUR"],
        feeBps: 0,
        extra: {},
      },
      fields: [
        {
          key: "paypal_email",
          labelEn: "PayPal email",
          labelFa: "ایمیل پی‌پال",
          fieldType: "email",
          isRequired: true,
          options: [],
        },
        {
          key: "amount",
          labelEn: "Amount",
          labelFa: "مبلغ",
          fieldType: "number",
          isRequired: true,
          options: [],
        },
        {
          key: "currency",
          labelEn: "Currency",
          labelFa: "ارز",
          fieldType: "select",
          isRequired: true,
          options: [
            { value: "USD", labelEn: "USD", labelFa: "دلار" },
            { value: "EUR", labelEn: "EUR", labelFa: "یورو" },
          ],
        },
      ],
    });
  }

  logger.info("seed_locked_catalog_complete", {
    aiCount: AI_SERVICE_CATALOG.length,
    paypalCount: PAYPAL_SERVICE_CATALOG.length,
  });
}
