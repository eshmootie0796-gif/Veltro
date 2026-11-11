import { and, count, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { orders } from "../../db/schema";
import type { AuthUser } from "../../auth/rbac";
import { assertAdmin } from "../../auth/rbac";
import {
  buildPaginationMeta,
  paginationOffset,
  parseListQuery,
} from "../../query/pagination";
import { getOrderAdmin } from "../orders/lifecycle";

export async function listOrdersAdmin(actor: AuthUser, query: unknown) {
  assertAdmin(actor);
  const parsed = parseListQuery(query);
  const status =
    typeof (query as { status?: string }).status === "string"
      ? (query as { status: string }).status
      : undefined;
  const userId =
    typeof (query as { userId?: string }).userId === "string"
      ? (query as { userId: string }).userId
      : undefined;

  const filters = [];
  if (status) filters.push(eq(orders.status, status));
  if (userId) filters.push(eq(orders.userId, userId));
  const where = filters.length ? and(...filters) : undefined;

  const totalRows = await db.select({ value: count() }).from(orders).where(where);
  const total = Number(totalRows[0]?.value ?? 0);
  const rows = await db.query.orders.findMany({
    where,
    orderBy: [desc(orders.createdAt)],
    limit: parsed.pageSize,
    offset: paginationOffset(parsed.page, parsed.pageSize),
    with: { items: true },
  });

  return {
    items: rows.map((o) => ({
      id: o.id,
      userId: o.userId,
      status: o.status,
      payableToman: o.payableToman,
      lastStatusNote: o.lastStatusNote,
      createdAt: o.createdAt.toISOString(),
      itemCount: o.items.length,
    })),
    meta: buildPaginationMeta(total, parsed.page, parsed.pageSize),
  };
}

export async function getOrderDetailAdmin(actor: AuthUser, orderId: string) {
  return getOrderAdmin(actor, orderId);
}
