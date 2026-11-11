import { pgTable, text, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { idColumn, signedToman, cryptoNumeric, utcTimestamp } from "./_shared";
import { users } from "./users";
import { currencies } from "./currencies";
import { fiatWallets, cryptoWallets, cryptoWalletBalances } from "./wallets";

/**
 * Immutable Toman wallet ledger. Append-only; never update or delete.
 * type: deposit | withdrawal | payment | refund | fee | adjustment
 * amountToman is signed delta. balanceBefore/balanceAfter are snapshots.
 */
export const fiatWalletTransactions = pgTable(
  "fiat_wallet_transactions",
  {
    id: idColumn(),
    walletId: text("wallet_id")
      .notNull()
      .references(() => fiatWallets.id),
    userId: text("user_id").references(() => users.id),
    type: text("type").notNull(),
    amountToman: signedToman("amount_toman"),
    balanceBefore: signedToman("balance_before").default(0),
    balanceAfter: signedToman("balance_after"),
    referenceType: text("reference_type"),
    referenceId: text("reference_id"),
    note: text("note"),
    createdAt: utcTimestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("fiat_wallet_transactions_wallet_idx").on(t.walletId),
    index("fiat_wallet_transactions_user_idx").on(t.userId),
    index("fiat_wallet_transactions_ref_idx").on(t.referenceType, t.referenceId),
    index("fiat_wallet_transactions_created_idx").on(t.createdAt),
  ],
);

/**
 * Immutable cryptocurrency ledger. Append-only; never update or delete.
 * type: deposit | withdrawal | conversion | trade | adjustment
 * amount is signed decimal string delta.
 */
export const cryptoWalletTransactions = pgTable(
  "crypto_wallet_transactions",
  {
    id: idColumn(),
    walletId: text("wallet_id")
      .notNull()
      .references(() => cryptoWallets.id),
    balanceId: text("balance_id")
      .notNull()
      .references(() => cryptoWalletBalances.id),
    userId: text("user_id").references(() => users.id),
    currencyId: text("currency_id")
      .notNull()
      .references(() => currencies.id),
    type: text("type").notNull(),
    amount: cryptoNumeric("amount"),
    balanceBefore: cryptoNumeric("balance_before").default("0"),
    balanceAfter: cryptoNumeric("balance_after"),
    referenceType: text("reference_type"),
    referenceId: text("reference_id"),
    note: text("note"),
    createdAt: utcTimestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("crypto_wallet_transactions_wallet_idx").on(t.walletId),
    index("crypto_wallet_transactions_balance_idx").on(t.balanceId),
    index("crypto_wallet_transactions_user_idx").on(t.userId),
    index("crypto_wallet_transactions_ref_idx").on(t.referenceType, t.referenceId),
    index("crypto_wallet_transactions_created_idx").on(t.createdAt),
  ],
);

export const fiatWalletTransactionRelations = relations(fiatWalletTransactions, ({ one }) => ({
  wallet: one(fiatWallets, {
    fields: [fiatWalletTransactions.walletId],
    references: [fiatWallets.id],
  }),
  user: one(users, { fields: [fiatWalletTransactions.userId], references: [users.id] }),
}));

export const cryptoWalletTransactionRelations = relations(cryptoWalletTransactions, ({ one }) => ({
  wallet: one(cryptoWallets, {
    fields: [cryptoWalletTransactions.walletId],
    references: [cryptoWallets.id],
  }),
  balance: one(cryptoWalletBalances, {
    fields: [cryptoWalletTransactions.balanceId],
    references: [cryptoWalletBalances.id],
  }),
  user: one(users, { fields: [cryptoWalletTransactions.userId], references: [users.id] }),
  currency: one(currencies, {
    fields: [cryptoWalletTransactions.currencyId],
    references: [currencies.id],
  }),
}));
