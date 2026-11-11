import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { auditLogs, roles, users } from "../../db/schema";
import { assertSuperAdmin, type AuthUser } from "../../auth/rbac";
import { ConflictError, NotFoundError } from "../../errors";
import { newId } from "../../ids";
import { parseOrThrow, zEmail, zNonEmpty } from "../../validation/zod";
import { hashPassword } from "../../auth/password";
import { withTransaction } from "../../db/transaction";
import { provisionUser } from "./provision";

export const assignRoleSchema = z.object({
  role: z.enum(["customer", "admin", "super_admin"]),
});

async function countActiveSuperAdmins(excludeUserId?: string) {
  const superRole = await db.query.roles.findFirst({ where: eq(roles.slug, "super_admin") });
  if (!superRole) return 0;

  const all = await db.query.users.findMany({
    where: and(eq(users.roleId, superRole.id), eq(users.status, "active")),
  });
  return all.filter((u) => u.id !== excludeUserId).length;
}

export async function assignUserRole(actor: AuthUser, targetUserId: string, raw: unknown) {
  assertSuperAdmin(actor);
  const { role: nextRole } = parseOrThrow(assignRoleSchema, raw);

  const target = await db.query.users.findFirst({
    where: eq(users.id, targetUserId),
    with: { role: true },
  });
  if (!target || target.status === "deleted") {
    throw new NotFoundError("User not found");
  }

  const currentSlug = target.role?.slug;
  if (currentSlug === nextRole) {
    return { role: nextRole };
  }

  if (currentSlug === "super_admin" && nextRole !== "super_admin") {
    const remaining = await countActiveSuperAdmins(targetUserId);
    if (remaining < 1) {
      throw new ConflictError("Cannot demote the last active Super Admin");
    }
  }

  const roleRow = await db.query.roles.findFirst({ where: eq(roles.slug, nextRole) });
  if (!roleRow) throw new NotFoundError("Role not found");

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        roleId: roleRow.id,
        sessionVersion: target.sessionVersion + 1,
        updatedAt: new Date(),
      })
      .where(eq(users.id, targetUserId));

    await tx.insert(auditLogs).values({
      id: newId(),
      actorId: actor.id,
      action: "user.assign_role",
      entityType: "user",
      entityId: targetUserId,
      before: { role: currentSlug },
      after: { role: nextRole },
    });
  });

  return { role: nextRole };
}

export const createAdminSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(32)
    .regex(/^[a-z0-9_]+$/),
  email: zEmail,
  password: z.string().min(8).max(128),
  firstName: zNonEmpty.max(80),
  lastName: zNonEmpty.max(80),
});

/** Super Admin creates an admin account. */
export async function createAdminAccount(actor: AuthUser, raw: unknown) {
  assertSuperAdmin(actor);
  const input = parseOrThrow(createAdminSchema, raw);
  const passwordHash = await hashPassword(input.password);

  const created = await withTransaction(async (tx) => {
    const user = await provisionUser(tx, {
      username: input.username,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      passwordHash,
      emailVerified: new Date(),
      roleSlug: "admin",
    });

    await tx.insert(auditLogs).values({
      id: newId(),
      actorId: actor.id,
      action: "admin.create",
      entityType: "user",
      entityId: user.id,
      after: { role: "admin", email: input.email },
    });

    return user;
  });

  return {
    id: created.id,
    username: input.username,
    email: input.email,
    role: "admin" as const,
  };
}
