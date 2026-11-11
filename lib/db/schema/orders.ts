import { pgTable, text, integer, jsonb, numeric, index, check } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { idColumn, toman, utcTimestamp } from "./_shared";
import { users } from "./users";
import { products, productVariants } from "./products";

/**
 * Independent purchase (no cart). All financial fields are server snapshots.
 * Customer-facing: paid | pending_admin_review | processing | completed |
 * cancellation_requested | cancelled | rejected
 * Internal unpaid: awaiting_payment | expired
 */
export const orders = pgTable(
  "orders",
  {
    id: idColumn(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    status: text("status").notNull().default("awaiting_payment"),
    currencyCode: text("currency_code").notNull().default("IRT"),
    subtotalToman: toman("subtotal_toman"),
    feeToman: toman("fee_toman").default(0),
    fixedCostToman: toman("fixed_cost_toman").default(0),
    discountToman: toman("discount_toman").default(0),
    exchangeRateUsed: numeric("exchange_rate_used", {
      precision: 36,
      scale: 18,
    }),
    exchangeBaseCode: text("exchange_base_code"),
    exchangeQuoteCode: text("exchange_quote_code"),
    payableToman: toman("payable_toman"),
    discountCodeSnapshot: text("discount_code_snapshot"),
    discountId: text("discount_id"),
    pricingSnapshot: jsonb("pricing_snapshot").$type<Record<string, unknown>>().notNull(),
    customerInputSnapshot: jsonb("customer_input_snapshot").$type<Record<string, unknown>>(),
    /** Exactly 15 minutes after creation for unpaid orders. */
    paymentExpiresAt: utcTimestamp("payment_expires_at"),
    lastStatusNote: text("last_status_note"),
    createdAt: utcTimestamp("created_at").defaultNow().notNull(),
    updatedAt: utcTimestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("orders_user_idx").on(t.userId),
    index("orders_status_idx").on(t.status),
    index("orders_created_idx").on(t.createdAt),
    index("orders_payment_expires_idx").on(t.paymentExpiresAt),
    check(
      "orders_amounts_nonneg_chk",
      sql`subtotal_toman >= 0 AND fee_toman >= 0 AND fixed_cost_toman >= 0 AND discount_toman >= 0 AND payable_toman >= 0`,
    ),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: idColumn(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id),
    productTitleSnap: text("product_title_snap").notNull(),
    variantNameSnap: text("variant_name_snap").notNull(),
    quantity: integer("quantity").notNull().default(1),
    unitPriceToman: toman("unit_price_toman"),
    lineTotalToman: toman("line_total_toman"),
    fieldValuesSnap: jsonb("field_values_snap").$type<Record<string, unknown>>(),
  },
  (t) => [
    index("order_items_order_idx").on(t.orderId),
    index("order_items_product_idx").on(t.productId),
    check("order_items_qty_positive_chk", sql`quantity > 0`),
    check("order_items_prices_nonneg_chk", sql`unit_price_toman >= 0 AND line_total_toman >= 0`),
  ],
);

/** Append-only order status transitions. */
export const orderStatusHistory = pgTable(
  "order_status_history",
  {
    id: idColumn(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    actorId: text("actor_id").references(() => users.id),
    note: text("note"),
    createdAt: utcTimestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("order_status_history_order_idx").on(t.orderId),
    index("order_status_history_created_idx").on(t.createdAt),
  ],
);

/**
 * Capacity hold for finite variants. Tracked inside financial/inventory transactions.
 * status: reserved | consumed | released | expired
 */
export const capacityReservations = pgTable(
  "capacity_reservations",
  {
    id: idColumn(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id),
    quantity: integer("quantity").notNull(),
    status: text("status").notNull().default("reserved"),
    expiresAt: utcTimestamp("expires_at").notNull(),
    createdAt: utcTimestamp("created_at").defaultNow().notNull(),
    updatedAt: utcTimestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("capacity_reservations_order_idx").on(t.orderId),
    index("capacity_reservations_variant_status_idx").on(t.variantId, t.status),
    index("capacity_reservations_expires_idx").on(t.expiresAt),
    check("capacity_reservations_qty_positive_chk", sql`quantity > 0`),
  ],
);

export const orderRelations = relations(orders, ({ one, many }) => ({
  user: one(users, { fields: [orders.userId], references: [users.id] }),
  items: many(orderItems),
  statusHistory: many(orderStatusHistory),
  reservations: many(capacityReservations),
}));

export const orderItemRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  product: one(products, { fields: [orderItems.productId], references: [products.id] }),
  variant: one(productVariants, {
    fields: [orderItems.variantId],
    references: [productVariants.id],
  }),
}));

export const orderStatusHistoryRelations = relations(orderStatusHistory, ({ one }) => ({
  order: one(orders, { fields: [orderStatusHistory.orderId], references: [orders.id] }),
  actor: one(users, { fields: [orderStatusHistory.actorId], references: [users.id] }),
}));

export const capacityReservationRelations = relations(capacityReservations, ({ one }) => ({
  order: one(orders, { fields: [capacityReservations.orderId], references: [orders.id] }),
  variant: one(productVariants, {
    fields: [capacityReservations.variantId],
    references: [productVariants.id],
  }),
}));
