import { pgTable, text, integer, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { idColumn, utcTimestamp } from "./_shared";
import { users } from "./users";
import { products } from "./products";
import { orders } from "./orders";

/**
 * Product reviews tied to a fulfilled order.
 * moderation: pending | approved | rejected
 */
export const reviews = pgTable(
  "reviews",
  {
    id: idColumn(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    rating: integer("rating").notNull(),
    title: text("title"),
    body: text("body"),
    moderation: text("moderation").notNull().default("pending"),
    createdAt: utcTimestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("reviews_order_user_product_idx").on(t.orderId, t.userId, t.productId),
    index("reviews_product_idx").on(t.productId),
    index("reviews_user_idx").on(t.userId),
    check("reviews_rating_chk", sql`rating >= 1 AND rating <= 5`),
  ],
);

export const reviewRelations = relations(reviews, ({ one }) => ({
  user: one(users, { fields: [reviews.userId], references: [users.id] }),
  product: one(products, { fields: [reviews.productId], references: [products.id] }),
  order: one(orders, { fields: [reviews.orderId], references: [orders.id] }),
}));
