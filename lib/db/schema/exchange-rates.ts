import { pgTable, text, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { idColumn, bool, cryptoNumeric, utcTimestamp } from "./_shared";
import { currencies } from "./currencies";

/**
 * Server-owned exchange rates. Clients never supply rates for pricing.
 * rate = quote currency units per 1 unit of base (numeric, not float).
 */
export const exchangeRates = pgTable(
  "exchange_rates",
  {
    id: idColumn(),
    baseCurrencyId: text("base_currency_id")
      .notNull()
      .references(() => currencies.id),
    quoteCurrencyId: text("quote_currency_id")
      .notNull()
      .references(() => currencies.id),
    rate: cryptoNumeric("rate"),
    isActive: bool("is_active").default(true),
    updatedAt: utcTimestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("exchange_rates_pair_idx").on(t.baseCurrencyId, t.quoteCurrencyId),
    index("exchange_rates_active_idx").on(t.isActive),
    check("exchange_rates_rate_positive_chk", sql`rate > 0`),
  ],
);

export const exchangeRateRelations = relations(exchangeRates, ({ one }) => ({
  baseCurrency: one(currencies, {
    fields: [exchangeRates.baseCurrencyId],
    references: [currencies.id],
    relationName: "exchange_rate_base",
  }),
  quoteCurrency: one(currencies, {
    fields: [exchangeRates.quoteCurrencyId],
    references: [currencies.id],
    relationName: "exchange_rate_quote",
  }),
}));
