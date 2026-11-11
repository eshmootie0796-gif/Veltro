import { and, count, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { auditLogs } from "../../db/schema";
import type { AuthUser } from "../../auth/rbac";
import { assertSuperAdmin } from "../../auth/rbac";
import {
  buildPaginationMeta,
  paginationOffset,
  parseListQuery,
} from "../../query/pagination";

/** Immutable. Super Admin view only. No update/delete APIs exist. */
export async function listAuditLogs(actor: AuthUser, query: unknown) {
  assertSuperAdmin(actor);
  const parsed = parseListQuery(query);
  const action =
    typeof (query as { action?: string }).action === "string"
      ? (query as { action: string }).action
      : undefined;
  const entityType =
    typeof (query as { entityType?: string }).entityType === "string"
      ? (query as { entityType: string }).entityType
      : undefined;

  const filters = [];
  if (action) filters.push(eq(auditLogs.action, action));
  if (entityType) filters.push(eq(auditLogs.entityType, entityType));
  const where = filters.length ? and(...filters) : undefined;

  const totalRows = await db.select({ value: count() }).from(auditLogs).where(where);
  const total = Number(totalRows[0]?.value ?? 0);
  const rows = await db.query.auditLogs.findMany({
    where,
    orderBy: [desc(auditLogs.createdAt)],
    limit: parsed.pageSize,
    offset: paginationOffset(parsed.page, parsed.pageSize),
  });

  return {
    items: rows.map((r) => ({
      id: r.id,
      actorId: r.actorId,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      before: r.before,
      after: r.after,
      createdAt: r.createdAt.toISOString(),
    })),
    meta: buildPaginationMeta(total, parsed.page, parsed.pageSize),
  };
}
