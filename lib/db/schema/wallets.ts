import { pgTable, text, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { idColumn, toman, cryptoNumeric, utcTimestamp } from "./_shared";
import { users } from "./users";
import { currencies } from "./currencies";

/**
 * One Toman (IRT) fiat wallet per customer.
 * No ON DELETE CASCADE: financial history must survive account soft-delete.
 */
export const fiatWallets = pgTable(
  "fiat_wallets",
  {
    id: idColumn(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    balanceToman: toman("balance_toman").default(0),
    createdAt: utcTimestamp("created_at").defaultNow().notNull(),
    updatedAt: utcTimestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("fiat_wallets_user_idx").on(t.userId),
    check("fiat_wallets_balance_nonneg_chk", sql`balance_toman >= 0`),
  ],
);

/**
 * One internal cryptocurrency wallet account per customer.
 * Per-currency balances live in crypto_wallet_balances.
 */
export const cryptoWallets = pgTable(
  "crypto_wallets",
  {
    id: idColumn(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: utcTimestamp("created_at").defaultNow().notNull(),
    updatedAt: utcTimestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("crypto_wallets_user_idx").on(t.userId)],
);

export const cryptoWalletBalances = pgTable(
  "crypto_wallet_balances",
  {
    id: idColumn(),
    walletId: text("wallet_id")
      .notNull()
      .references(() => cryptoWallets.id),
    currencyId: text("currency_id")
      .notNull()
      .references(() => currencies.id),
    balance: cryptoNumeric("balance").default("0"),
    updatedAt: utcTimestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("crypto_wallet_balances_wallet_currency_idx").on(t.walletId, t.currencyId),
    index("crypto_wallet_balances_currency_idx").on(t.currencyId),
    check("crypto_wallet_balances_nonneg_chk", sql`balance >= 0`),
  ],
);

/** Platform-held cryptocurrency reserve per currency. */
export const cryptoReserves = pgTable(
  "crypto_reserves",
  {
    id: idColumn(),
    currencyId: text("currency_id")
      .notNull()
      .references(() => currencies.id),
    balance: cryptoNumeric("balance").default("0"),
    updatedAt: utcTimestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("crypto_reserves_currency_idx").on(t.currencyId),
    check("crypto_reserves_balance_nonneg_chk", sql`balance >= 0`),
  ],
);

/**
 * Immutable reserve adjustment records. Never update or delete.
 */
export const reserveAdjustments = pgTable(
  "reserve_adjustments",
  {
    id: idColumn(),
    reserveId: text("reserve_id")
      .notNull()
      .references(() => cryptoReserves.id),
    currencyId: text("currency_id")
      .notNull()
      .references(() => currencies.id),
    amount: cryptoNumeric("amount"),
    balanceAfter: cryptoNumeric("balance_after"),
    reason: text("reason").notNull(),
    actorId: text("actor_id").references(() => users.id),
    referenceType: text("reference_type"),
    referenceId: text("reference_id"),
    createdAt: utcTimestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("reserve_adjustments_reserve_idx").on(t.reserveId),
    index("reserve_adjustments_created_idx").on(t.createdAt),
  ],
);

export const fiatWalletRelations = relations(fiatWallets, ({ one }) => ({
  user: one(users, { fields: [fiatWallets.userId], references: [users.id] }),
}));

export const cryptoWalletRelations = relations(cryptoWallets, ({ one, many }) => ({
  user: one(users, { fields: [cryptoWallets.userId], references: [users.id] }),
  balances: many(cryptoWalletBalances),
}));

export const cryptoWalletBalanceRelations = relations(cryptoWalletBalances, ({ one }) => ({
  wallet: one(cryptoWallets, {
    fields: [cryptoWalletBalances.walletId],
    references: [cryptoWallets.id],
  }),
  currency: one(currencies, {
    fields: [cryptoWalletBalances.currencyId],
    references: [currencies.id],
  }),
}));

export const cryptoReserveRelations = relations(cryptoReserves, ({ one, many }) => ({
  currency: one(currencies, {
    fields: [cryptoReserves.currencyId],
    references: [currencies.id],
  }),
  adjustments: many(reserveAdjustments),
}));

export const reserveAdjustmentRelations = relations(reserveAdjustments, ({ one }) => ({
  reserve: one(cryptoReserves, {
    fields: [reserveAdjustments.reserveId],
    references: [cryptoReserves.id],
  }),
  currency: one(currencies, {
    fields: [reserveAdjustments.currencyId],
    references: [currencies.id],
  }),
  actor: one(users, { fields: [reserveAdjustments.actorId], references: [users.id] }),
}));
