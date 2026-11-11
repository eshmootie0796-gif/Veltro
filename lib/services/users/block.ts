import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { auditLogs, sessions, users } from "../../db/schema";
import { assertAdmin, type AuthUser } from "../../auth/rbac";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";
import { newId } from "../../ids";
import { parseOrThrow, zNonEmpty } from "../../validation/zod";

export const blockUserSchema = z.object({
  reason: zNonEmpty.max(1000),
});

export async function blockUser(actor: AuthUser, targetUserId: string, raw: unknown) {
  assertAdmin(actor);
  const { reason } = parseOrThrow(blockUserSchema, raw);

  if (actor.id === targetUserId) {
    throw new ValidationError("Cannot block your own account");
  }

  const target = await db.query.users.findFirst({
    where: eq(users.id, targetUserId),
    with: { role: true },
  });
  if (!target || target.status === "deleted") {
    throw new NotFoundError("User not found");
  }
  if (target.status === "blocked") {
    throw new ConflictError("User is already blocked");
  }
  if (target.role?.slug === "super_admin" && actor.role !== "super_admin") {
    throw new ValidationError("Only super_admin can block a super_admin");
  }
  if (target.role?.slug === "admin" && actor.role !== "super_admin") {
    throw new ValidationError("Only super_admin can block an admin");
  }

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        status: "blocked",
        blockedReason: reason,
        blockedAt: new Date(),
        blockedById: actor.id,
        sessionVersion: target.sessionVersion + 1,
        updatedAt: new Date(),
      })
      .where(eq(users.id, targetUserId));

    await tx.delete(sessions).where(eq(sessions.userId, targetUserId));

    await tx.insert(auditLogs).values({
      id: newId(),
      actorId: actor.id,
      action: "user.block",
      entityType: "user",
      entityId: targetUserId,
      before: { status: target.status },
      after: { status: "blocked", reason },
    });
  });

  return { blocked: true as const };
}

export async function unblockUser(actor: AuthUser, targetUserId: string, raw: unknown) {
  assertAdmin(actor);
  const { reason } = parseOrThrow(blockUserSchema, raw);

  const target = await db.query.users.findFirst({ where: eq(users.id, targetUserId) });
  if (!target || target.status === "deleted") {
    throw new NotFoundError("User not found");
  }
  if (target.status !== "blocked") {
    throw new ConflictError("User is not blocked");
  }

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        status: "active",
        blockedReason: null,
        blockedAt: null,
        blockedById: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, targetUserId));

    await tx.insert(auditLogs).values({
      id: newId(),
      actorId: actor.id,
      action: "user.unblock",
      entityType: "user",
      entityId: targetUserId,
      before: { status: "blocked", reason: target.blockedReason },
      after: { status: "active", reason },
    });
  });

  return { unblocked: true as const };
}
