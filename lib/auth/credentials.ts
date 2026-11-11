import { eq, or } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";
import { verifyPassword } from "./password";
import { isRoleSlug } from "./rbac";

/**
 * Resolve a credentials login (username or email + password).
 * Returns null on failure without revealing which field mismatched.
 */
export async function authenticateCredentials(identifier: string, password: string) {
  const normalized = identifier.trim().toLowerCase();
  if (!normalized || !password) return null;

  const user = await db.query.users.findFirst({
    where: or(eq(users.email, normalized), eq(users.username, normalized)),
    with: { role: true },
  });

  if (!user || user.status !== "active" || !user.passwordHash) {
    return null;
  }

  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) return null;

  const roleSlug = user.role?.slug;
  if (!roleSlug || !isRoleSlug(roleSlug)) return null;

  await db
    .update(users)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, user.id));

  return {
    id: user.id,
    email: user.email,
    username: user.username,
    name: user.name,
    role: roleSlug,
    status: user.status,
    emailVerified: user.emailVerified,
    sessionVersion: user.sessionVersion,
  };
}
