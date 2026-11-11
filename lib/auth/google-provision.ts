import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { accounts, users } from "../db/schema";
import { withTransaction } from "../db/transaction";
import { provisionUser } from "../services/users/provision";
import { newId } from "../ids";
import { isRoleSlug } from "./rbac";

function splitName(fullName: string | null | undefined): { firstName: string; lastName: string } {
  const trimmed = (fullName ?? "").trim();
  if (!trimmed) return { firstName: "Google", lastName: "User" };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "User" };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(" ") };
}

async function uniqueUsernameFromEmail(email: string): Promise<string> {
  const base = email
    .split("@")[0]!
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .slice(0, 24);
  const seed = base.length >= 3 ? base : `user_${base}`;

  for (let i = 0; i < 8; i++) {
    const candidate = i === 0 ? seed : `${seed}_${newId().slice(0, 4)}`;
    const existing = await db.query.users.findFirst({ where: eq(users.username, candidate) });
    if (!existing) return candidate;
  }
  return `user_${newId().slice(0, 12)}`;
}

async function upsertGoogleAccount(userId: string, providerAccountId: string) {
  const existing = await db.query.accounts.findFirst({
    where: and(eq(accounts.provider, "google"), eq(accounts.providerAccountId, providerAccountId)),
  });
  if (existing) {
    if (existing.userId !== userId) return null;
    return existing;
  }
  const id = newId();
  await db.insert(accounts).values({
    id,
    userId,
    type: "oauth",
    provider: "google",
    providerAccountId,
  });
  return { id, userId };
}

/**
 * Find or create a customer for Google OAuth.
 * Never soft-links into admin/super_admin or password accounts by email alone.
 */
export async function findOrCreateGoogleUser(profile: {
  email?: string | null;
  name?: string | null;
  image?: string | null;
  providerAccountId?: string | null;
}) {
  const email = profile.email?.toLowerCase();
  if (!email) return null;
  const providerAccountId = profile.providerAccountId?.trim();
  if (!providerAccountId) return null;

  const byProvider = await db.query.accounts.findFirst({
    where: and(eq(accounts.provider, "google"), eq(accounts.providerAccountId, providerAccountId)),
  });
  if (byProvider) {
    const linked = await db.query.users.findFirst({
      where: eq(users.id, byProvider.userId),
      with: { role: true },
    });
    if (!linked || linked.status !== "active") return null;
    const roleSlug = linked.role?.slug;
    if (!roleSlug || !isRoleSlug(roleSlug)) return null;
    if (roleSlug !== "customer") return null;

    await db
      .update(users)
      .set({
        lastLoginAt: new Date(),
        image: profile.image ?? linked.image,
        updatedAt: new Date(),
      })
      .where(eq(users.id, linked.id));

    return {
      id: linked.id,
      email: linked.email,
      username: linked.username,
      name: linked.name,
      role: roleSlug,
      status: linked.status,
      emailVerified: linked.emailVerified ?? new Date(),
      sessionVersion: linked.sessionVersion,
    };
  }

  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
    with: { role: true },
  });

  if (existing) {
    if (existing.status !== "active") return null;
    const roleSlug = existing.role?.slug;
    if (!roleSlug || !isRoleSlug(roleSlug)) return null;
    // Privilege and password accounts must not be claimed by Google email match.
    if (roleSlug !== "customer") return null;
    if (existing.passwordHash) return null;
    if (!existing.emailVerified) return null;

    const linked = await upsertGoogleAccount(existing.id, providerAccountId);
    if (!linked) return null;

    await db
      .update(users)
      .set({
        lastLoginAt: new Date(),
        image: profile.image ?? existing.image,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing.id));

    return {
      id: existing.id,
      email: existing.email,
      username: existing.username,
      name: existing.name,
      role: roleSlug,
      status: existing.status,
      emailVerified: existing.emailVerified,
      sessionVersion: existing.sessionVersion,
    };
  }

  const { firstName, lastName } = splitName(profile.name);
  const username = await uniqueUsernameFromEmail(email);

  const created = await withTransaction(async (tx) => {
    const user = await provisionUser(tx, {
      username,
      email,
      firstName,
      lastName,
      passwordHash: null,
      emailVerified: new Date(),
      image: profile.image ?? null,
      roleSlug: "customer",
    });
    await tx.insert(accounts).values({
      id: newId(),
      userId: user.id,
      type: "oauth",
      provider: "google",
      providerAccountId,
    });
    return user;
  });

  return {
    id: created.id,
    email,
    username,
    name: created.name,
    role: "customer" as const,
    status: "active",
    emailVerified: new Date(),
    sessionVersion: 0,
  };
}
