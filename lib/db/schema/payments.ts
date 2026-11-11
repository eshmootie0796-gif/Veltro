import { pgTable, text, numeric, index, check } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { idColumn, toman, utcTimestamp } from "./_shared";
import { orders } from "./orders";
import { users } from "./users";

/**
 * Simulated payments only. Server is sole authority on success.
 * purpose: order | topup
 * method: wallet_fiat | simulated_gateway
 * status: pending | succeeded | failed | refunded | forfeited_refund
 * Never auto-retry failed financial operations.
 */
export const payments = pgTable(
  "payments",
  {
    id: idColumn(),
    purpose: text("purpose").notNull().default("order"),
    orderId: text("order_id").references(() => orders.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    method: text("method").notNull(),
    status: text("status").notNull().default("pending"),
    amountToman: toman("amount_toman"),
    cryptoCurrencyCode: text("crypto_currency_code"),
    cryptoAmount: numeric("crypto_amount", { precision: 36, scale: 18 }),
    gatewayRef: text("gateway_ref"),
    failureReason: text("failure_reason"),
    createdAt: utcTimestamp("created_at").defaultNow().notNull(),
    updatedAt: utcTimestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("payments_order_idx").on(t.orderId),
    index("payments_user_idx").on(t.userId),
    index("payments_status_idx").on(t.status),
    index("payments_purpose_idx").on(t.purpose),
    check("payments_amount_nonneg_chk", sql`amount_toman >= 0`),
    check(
      "payments_purpose_chk",
      sql`purpose IN ('order', 'topup')`,
    ),
    check(
      "payments_order_purpose_chk",
      sql`(purpose = 'order' AND order_id IS NOT NULL) OR (purpose = 'topup' AND order_id IS NULL)`,
    ),
  ],
);

export const paymentRelations = relations(payments, ({ one }) => ({
  order: one(orders, { fields: [payments.orderId], references: [orders.id] }),
  user: one(users, { fields: [payments.userId], references: [users.id] }),
}));
