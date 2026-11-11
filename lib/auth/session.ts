import { UnauthorizedError, ForbiddenError } from "../errors";
import { auth } from "./config";
import {
  assertAdmin,
  assertRole,
  assertSuperAdmin,
  assertVerifiedCustomer,
  type AuthUser,
} from "./rbac";
import type { RoleSlug } from "./constants";
import type { SessionUser } from "./types";

function toAuthUser(user: SessionUser): AuthUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    status: user.status,
    emailVerified: user.emailVerified ? new Date(user.emailVerified) : null,
    sessionVersion: user.sessionVersion,
  };
}

export async function getSessionUser(): Promise<AuthUser | null> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || user.sessionVersion < 0 || user.status !== "active") {
    return null;
  }
  return toAuthUser(user);
}

export async function requireAuth(): Promise<AuthUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new UnauthorizedError();
  }
  return user;
}

export async function requireRoles(allowed: RoleSlug | RoleSlug[]): Promise<AuthUser> {
  const user = await requireAuth();
  assertRole(user, allowed);
  return user;
}

export async function requireAdmin(): Promise<AuthUser> {
  const user = await requireAuth();
  assertAdmin(user);
  return user;
}

export async function requireSuperAdmin(): Promise<AuthUser> {
  const user = await requireAuth();
  assertSuperAdmin(user);
  return user;
}

export async function requireVerifiedCustomer(): Promise<AuthUser> {
  const user = await requireAuth();
  assertVerifiedCustomer(user);
  return user;
}

/** Public browse allowed for guests and unverified users; private actions use requireVerifiedCustomer. */
export async function requireActiveAccount(): Promise<AuthUser> {
  const user = await requireAuth();
  if (user.status !== "active") {
    throw new ForbiddenError("Account is not active");
  }
  return user;
}
