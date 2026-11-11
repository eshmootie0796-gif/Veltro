import { asc, eq } from "drizzle-orm";
import { db } from "../../db";
import { categories } from "../../db/schema";
import { NotFoundError } from "../../errors";
import { mapCategory } from "./mappers";

export async function listPublicCategories() {
  const rows = await db.query.categories.findMany({
    where: eq(categories.isActive, true),
    orderBy: [asc(categories.sortOrder)],
  });
  return rows.map(mapCategory);
}

export async function listAdminCategories() {
  const rows = await db.query.categories.findMany({
    orderBy: [asc(categories.sortOrder)],
  });
  return rows.map(mapCategory);
}

export async function getCategoryBySlug(slug: string) {
  const row = await db.query.categories.findFirst({ where: eq(categories.slug, slug) });
  if (!row) throw new NotFoundError("Category not found");
  return row;
}
