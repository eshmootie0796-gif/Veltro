import { and, asc, desc, type AnyColumn, type SQL } from "drizzle-orm";
import { z } from "zod";
import { parseOrThrow, zPaginationPage, zPaginationPageSize, zSortOrder } from "../validation/zod";

export const listQuerySchema = z.object({
  page: zPaginationPage,
  pageSize: zPaginationPageSize,
  sort: z.string().trim().min(1).optional(),
  order: zSortOrder,
  q: z.string().trim().max(200).optional(),
});

export type ListQuery = z.infer<typeof listQuerySchema>;

export type PaginationMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
};

export function parseListQuery(input: unknown): ListQuery {
  return parseOrThrow(listQuerySchema, input);
}

export function paginationOffset(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}

export function buildPaginationMeta(total: number, page: number, pageSize: number): PaginationMeta {
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  return {
    page,
    pageSize,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1 && totalPages > 0,
  };
}

export type SortMap = Record<string, AnyColumn>;

/**
 * Resolve sort column from an allow-list. Unknown sort keys fall back to defaultColumn.
 */
export function resolveSort(
  sortMap: SortMap,
  sort: string | undefined,
  order: "asc" | "desc",
  defaultColumn: AnyColumn,
): SQL {
  const column = (sort && sortMap[sort]) || defaultColumn;
  return order === "asc" ? asc(column) : desc(column);
}

/**
 * Combine optional SQL filter fragments with AND (skips undefined).
 */
export function combineFilters(...filters: Array<SQL | undefined>): SQL | undefined {
  const present = filters.filter((f): f is SQL => f !== undefined);
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  return and(...present);
}
