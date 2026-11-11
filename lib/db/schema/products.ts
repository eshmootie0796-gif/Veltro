import {
  pgTable,
  text,
  integer,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { idColumn, bool, toman, tomanNullable, utcTimestamp } from "./_shared";
import { categories } from "./categories";

export type ProductImage = {
  url: string;
  alt?: string;
  sortOrder?: number;
};

export type FieldOption = {
  value: string;
  labelEn: string;
  labelFa: string;
};

export type FieldValidation = {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
};

export type FieldVisibility = {
  fieldKey: string;
  equals?: string | number | boolean;
  in?: Array<string | number | boolean>;
};

/**
 * Shared product/service shell. Price and capacity live on variants.
 * type: product | service
 * catalogKey locks predefined AI/PayPal catalog entries.
 */
export const products = pgTable(
  "products",
  {
    id: idColumn(),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id),
    type: text("type").notNull().default("product"),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    imageUrl: text("image_url"),
    images: jsonb("images").$type<ProductImage[]>().notNull().default([]),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: bool("is_active").default(true),
    /** Stable key for seeded catalog items (ai.chatgpt, paypal.top-up). */
    catalogKey: text("catalog_key"),
    /** When true, admins cannot create duplicates or hard-delete; soft-deactivate only. */
    isCatalogLocked: bool("is_catalog_locked").default(false),
    minOrderAmountToman: tomanNullable("min_order_amount_toman"),
    maxOrderAmountToman: tomanNullable("max_order_amount_toman"),
    fixedAncillaryCostToman: toman("fixed_ancillary_cost_toman").default(0),
    /** Service fee in basis points (10000 = 100%). */
    serviceFeeBps: integer("service_fee_bps").notNull().default(0),
    deletedAt: utcTimestamp("deleted_at"),
    createdAt: utcTimestamp("created_at").defaultNow().notNull(),
    updatedAt: utcTimestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("products_slug_idx").on(t.slug),
    uniqueIndex("products_catalog_key_idx").on(t.catalogKey),
    index("products_category_idx").on(t.categoryId),
    index("products_type_idx").on(t.type),
    index("products_active_idx").on(t.isActive),
    index("products_sort_idx").on(t.sortOrder),
    index("products_deleted_at_idx").on(t.deletedAt),
    check(
      "products_service_fee_bps_chk",
      sql`service_fee_bps >= 0 AND service_fee_bps <= 10000`,
    ),
    check(
      "products_order_amount_range_chk",
      sql`min_order_amount_toman IS NULL OR max_order_amount_toman IS NULL OR min_order_amount_toman <= max_order_amount_toman`,
    ),
    check(
      "products_fixed_ancillary_nonneg_chk",
      sql`fixed_ancillary_cost_toman >= 0`,
    ),
  ],
);

/**
 * Plans / options under a product. Server-owned Toman price.
 * capacityMode: finite | unlimited
 * Capacity = max accepted orders (not physical stock). Reservation is order-module concern.
 */
export const productVariants = pgTable(
  "product_variants",
  {
    id: idColumn(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    sku: text("sku"),
    name: text("name").notNull(),
    label: text("label"),
    labelFa: text("label_fa"),
    priceToman: toman("price_toman"),
    capacityMode: text("capacity_mode").notNull().default("unlimited"),
    capacityTotal: integer("capacity_total"),
    capacityRemaining: integer("capacity_remaining"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: bool("is_active").default(true),
    deletedAt: utcTimestamp("deleted_at"),
    createdAt: utcTimestamp("created_at").defaultNow().notNull(),
    updatedAt: utcTimestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("product_variants_sku_idx").on(t.sku),
    index("product_variants_product_idx").on(t.productId),
    index("product_variants_active_idx").on(t.isActive),
    check(
      "product_variants_capacity_finite_chk",
      sql`(capacity_mode = 'unlimited' AND capacity_total IS NULL AND capacity_remaining IS NULL)
          OR (capacity_mode = 'finite' AND capacity_total IS NOT NULL AND capacity_remaining IS NOT NULL
              AND capacity_total >= 0 AND capacity_remaining >= 0 AND capacity_remaining <= capacity_total)`,
    ),
    check("product_variants_price_nonneg_chk", sql`price_toman >= 0`),
  ],
);

/**
 * Dynamic customer-input field definitions.
 * fieldType: text | email | number | select | multi_select | date | url | textarea | boolean
 */
export const productFieldDefinitions = pgTable(
  "product_field_definitions",
  {
    id: idColumn(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    labelEn: text("label_en").notNull(),
    labelFa: text("label_fa").notNull(),
    fieldType: text("field_type").notNull(),
    options: jsonb("options").$type<FieldOption[]>().notNull().default([]),
    isRequired: bool("is_required").default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    validation: jsonb("validation").$type<FieldValidation>().notNull().default({}),
    visibility: jsonb("visibility").$type<FieldVisibility | null>(),
    createdAt: utcTimestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("product_field_definitions_product_key_idx").on(t.productId, t.key),
    index("product_field_definitions_product_idx").on(t.productId),
  ],
);

/**
 * Category/product-specific admin configuration.
 * Shape validated by Zod per category slug in the service layer.
 */
export const productConfigs = pgTable(
  "product_configs",
  {
    id: idColumn(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    config: jsonb("config").$type<Record<string, unknown>>().notNull(),
    updatedAt: utcTimestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("product_configs_product_idx").on(t.productId)],
);

export const productRelations = relations(products, ({ one, many }) => ({
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  variants: many(productVariants),
  fieldDefinitions: many(productFieldDefinitions),
  config: one(productConfigs),
}));

export const productVariantRelations = relations(productVariants, ({ one }) => ({
  product: one(products, { fields: [productVariants.productId], references: [products.id] }),
}));

export const productFieldDefinitionRelations = relations(productFieldDefinitions, ({ one }) => ({
  product: one(products, {
    fields: [productFieldDefinitions.productId],
    references: [products.id],
  }),
}));

export const productConfigRelations = relations(productConfigs, ({ one }) => ({
  product: one(products, { fields: [productConfigs.productId], references: [products.id] }),
}));
