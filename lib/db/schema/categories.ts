import { pgTable, text, integer, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { idColumn, bool, utcTimestamp } from "./_shared";
import { products } from "./products";

/**
 * Flat marketplace categories. Exactly eight are seeded; no hierarchy in v1.
 * Per-category business logic lives in services + Zod config schemas.
 */
export const categories = pgTable(
  "categories",
  {
    id: idColumn(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description"),
    icon: text("icon"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: bool("is_active").default(true),
    createdAt: utcTimestamp("created_at").defaultNow().notNull(),
    updatedAt: utcTimestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("categories_sort_idx").on(t.sortOrder)],
);

export const categoryRelations = relations(categories, ({ many }) => ({
  products: many(products),
}));
