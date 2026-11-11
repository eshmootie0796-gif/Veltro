import { pgTable, text, jsonb, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { idColumn, toman, cryptoNumeric, utcTimestamp } from "./_shared";
import { users } from "./users";
import { currencies } from "./currencies";

/**
 * Platform IRT float used to pay customers on crypto sells.
 * Increased by customer buys; decreased by sells. Never negative.
 */
export const platformFiatTreasury = pgTable(
  "platform_fiat_treasury",
  {
    id: idColumn(),
    currencyCode: text("currency_code").notNull().default("IRT"),
    balanceToman: toman("balance_toman").default(0),
    updatedAt: utcTimestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("platform_fiat_treasury_currency_idx").on(t.currencyCode),
    check("platform_fiat_treasury_balance_nonneg_chk", sql`balance_toman >= 0`),
  ],
);

/**
 * Immutable trade journal. Idempotency via unique client key.
 * side: buy | sell | convert
 */
export const cryptoTrades = pgTable(
  "crypto_trades",
  {
    id: idColumn(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    side: text("side").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    sourceCurrencyId: text("source_currency_id").references(() => currencies.id),
    destinationCurrencyId: text("destination_currency_id").references(() => currencies.id),
    sourceAmount: cryptoNumeric("source_amount").default("0"),
    destinationAmount: cryptoNumeric("destination_amount").default("0"),
    baseToman: toman("base_toman").default(0),
    feeToman: toman("fee_toman").default(0),
    feeBps: text("fee_bps").notNull().default("0"),
    payableOrPayoutToman: toman("payable_or_payout_toman").default(0),
    pricingSnapshot: jsonb("pricing_snapshot").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("succeeded"),
    createdAt: utcTimestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("crypto_trades_idempotency_idx").on(t.userId, t.idempotencyKey),
    index("crypto_trades_user_idx").on(t.userId),
    index("crypto_trades_side_idx").on(t.side),
    index("crypto_trades_created_idx").on(t.createdAt),
    check("crypto_trades_side_chk", sql`side IN ('buy', 'sell', 'convert')`),
    check("crypto_trades_status_chk", sql`status IN ('succeeded', 'failed')`),
    check(
      "crypto_trades_amounts_nonneg_chk",
      sql`base_toman >= 0 AND fee_toman >= 0 AND payable_or_payout_toman >= 0`,
    ),
  ],
);

export const cryptoTradeRelations = relations(cryptoTrades, ({ one }) => ({
  user: one(users, { fields: [cryptoTrades.userId], references: [users.id] }),
  sourceCurrency: one(currencies, {
    fields: [cryptoTrades.sourceCurrencyId],
    references: [currencies.id],
  }),
  destinationCurrency: one(currencies, {
    fields: [cryptoTrades.destinationCurrencyId],
    references: [currencies.id],
  }),
}));
