import { db } from "../../db";
import type { DbTransaction } from "../../db/transaction";
import { auditLogs } from "../../db/schema";
import { newId } from "../../ids";

export async function writeAuditLog(
  input: {
    actorId: string | null;
    action: string;
    entityType?: string | null;
    entityId?: string | null;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    ip?: string | null;
    userAgent?: string | null;
  },
  executor: typeof db | DbTransaction = db,
) {
  await executor.insert(auditLogs).values({
    id: newId(),
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  });
}
