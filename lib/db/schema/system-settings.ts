import { pgTable, text, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { idColumn, utcTimestamp } from "./_shared";
import { users } from "./users";

/**
 * Key/value platform settings. Mutations must be audited in services.
 */
export const systemSettings = pgTable(
  "system_settings",
  {
    id: idColumn(),
    key: text("key").notNull(),
    value: jsonb("value").$type<Record<string, unknown> | string | number | boolean | null>().notNull(),
    updatedBy: text("updated_by").references(() => users.id),
    updatedAt: utcTimestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("system_settings_key_idx").on(t.key)],
);
