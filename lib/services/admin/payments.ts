import { count, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { fiatWalletTransactions, payments } from "../../db/schema";
import type { AuthUser } from "../../auth/rbac";
import { assertAdmin } from "../../auth/rbac";
import {
  buildPaginationMeta,
  paginationOffset,
  parseListQuery,
} from "../../query/pagination";

export async function listPaymentsAdmin(actor: AuthUser, query: unknown) {
  assertAdmin(actor);
  const parsed = parseListQuery(query);
  const status =
    typeof (query as { status?: string }).status === "string"
      ? (query as { status: string }).status
      : undefined;

  const where = status ? eq(payments.status, status) : undefined;
  const totalRows = await db.select({ value: count() }).from(payments).where(where);
  const total = Number(totalRows[0]?.value ?? 0);
  const rows = await db.query.payments.findMany({
    where,
    orderBy: [desc(payments.createdAt)],
    limit: parsed.pageSize,
    offset: paginationOffset(parsed.page, parsed.pageSize),
  });

  return {
    items: rows.map((p) => ({
      id: p.id,
      purpose: p.purpose,
      orderId: p.orderId,
      userId: p.userId,
      method: p.method,
      status: p.status,
      amountToman: p.amountToman,
      failureReason: p.failureReason,
      createdAt: p.createdAt.toISOString(),
    })),
    meta: buildPaginationMeta(total, parsed.page, parsed.pageSize),
  };
}

export async function listWalletTransactionsAdmin(actor: AuthUser, query: unknown) {
  assertAdmin(actor);
  const parsed = parseListQuery(query);
  const userId =
    typeof (query as { userId?: string }).userId === "string"
      ? (query as { userId: string }).userId
      : undefined;

  const where = userId ? eq(fiatWalletTransactions.userId, userId) : undefined;
  const totalRows = await db
    .select({ value: count() })
    .from(fiatWalletTransactions)
    .where(where);
  const total = Number(totalRows[0]?.value ?? 0);
  const rows = await db.query.fiatWalletTransactions.findMany({
    where,
    orderBy: [desc(fiatWalletTransactions.createdAt)],
    limit: parsed.pageSize,
    offset: paginationOffset(parsed.page, parsed.pageSize),
  });

  return {
    items: rows.map((t) => ({
      id: t.id,
      userId: t.userId,
      type: t.type,
      amountToman: t.amountToman,
      balanceBefore: t.balanceBefore,
      balanceAfter: t.balanceAfter,
      referenceType: t.referenceType,
      referenceId: t.referenceId,
      createdAt: t.createdAt.toISOString(),
    })),
    meta: buildPaginationMeta(total, parsed.page, parsed.pageSize),
  };
}
