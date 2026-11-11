import { pgTable, text, integer, index } from "drizzle-orm/pg-core";
import { idColumn, bool, utcTimestamp } from "./_shared";

/**
 * Supported currency definitions.
 * Fiat Toman uses code IRT with decimals=0. Crypto uses its native decimals.
 * kind: fiat | crypto
 */
export const currencies = pgTable(
  "currencies",
  {
    id: idColumn(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    decimals: integer("decimals").notNull(),
    isActive: bool("is_active").default(true),
    createdAt: utcTimestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("currencies_kind_idx").on(t.kind),
    index("currencies_active_idx").on(t.isActive),
  ],
);
