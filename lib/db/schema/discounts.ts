import { pgTable, text, integer, jsonb, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { idColumn, toman, tomanNullable, bool, utcTimestamp } from "./_shared";
import { orders } from "./orders";
import { users } from "./users";

/**
 * Discount codes. Server computes applied amounts; clients never supply them.
 * type: fixed | percentage
 * scopeType: all | category | product
 */
export const discounts = pgTable(
  "discounts",
  {
    id: idColumn(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull().default("fixed"),
    fixedAmountToman: tomanNullable("fixed_amount_toman"),
    percentageBps: integer("percentage_bps"),
    maxDiscountToman: tomanNullable("max_discount_toman"),
    isActive: bool("is_active").default(true),
    validFrom: utcTimestamp("valid_from"),
    validUntil: utcTimestamp("valid_until"),
    usageLimit: integer("usage_limit"),
    perUserLimit: integer("per_user_limit"),
    minOrderAmountToman: tomanNullable("min_order_amount_toman"),
    scopeType: text("scope_type").notNull().default("all"),
    scopeIds: jsonb("scope_ids").$type<string[]>().notNull().default([]),
    createdAt: utcTimestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("discounts_code_idx").on(t.code),
    index("discounts_active_idx").on(t.isActive),
    check(
      "discounts_percentage_bps_chk",
      sql`percentage_bps IS NULL OR (percentage_bps >= 0 AND percentage_bps <= 10000)`,
    ),
    check(
      "discounts_scope_type_chk",
      sql`scope_type IN ('all', 'category', 'product')`,
    ),
  ],
);

/**
 * Usage slot hold before payment completes. Independent from completed usages.
 * status: reserved | consumed | released | expired
 */
export const discountReservations = pgTable(
  "discount_reservations",
  {
    id: idColumn(),
    discountId: text("discount_id")
      .notNull()
      .references(() => discounts.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("reserved"),
    expiresAt: utcTimestamp("expires_at").notNull(),
    createdAt: utcTimestamp("created_at").defaultNow().notNull(),
    updatedAt: utcTimestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("discount_reservations_discount_status_idx").on(t.discountId, t.status),
    index("discount_reservations_order_idx").on(t.orderId),
    index("discount_reservations_expires_idx").on(t.expiresAt),
    uniqueIndex("discount_reservations_order_unique_idx").on(t.orderId),
  ],
);

/** Completed discount consumption. Immutable. */
export const discountUsages = pgTable(
  "discount_usages",
  {
    id: idColumn(),
    discountId: text("discount_id")
      .notNull()
      .references(() => discounts.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    amountToman: toman("amount_toman"),
    createdAt: utcTimestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("discount_usages_order_idx").on(t.orderId),
    index("discount_usages_discount_idx").on(t.discountId),
    index("discount_usages_user_idx").on(t.userId),
    check("discount_usages_amount_nonneg_chk", sql`amount_toman >= 0`),
  ],
);

export const discountRelations = relations(discounts, ({ many }) => ({
  reservations: many(discountReservations),
  usages: many(discountUsages),
}));

export const discountReservationRelations = relations(discountReservations, ({ one }) => ({
  discount: one(discounts, {
    fields: [discountReservations.discountId],
    references: [discounts.id],
  }),
  user: one(users, { fields: [discountReservations.userId], references: [users.id] }),
  order: one(orders, { fields: [discountReservations.orderId], references: [orders.id] }),
}));

export const discountUsageRelations = relations(discountUsages, ({ one }) => ({
  discount: one(discounts, { fields: [discountUsages.discountId], references: [discounts.id] }),
  user: one(users, { fields: [discountUsages.userId], references: [users.id] }),
  order: one(orders, { fields: [discountUsages.orderId], references: [orders.id] }),
}));
