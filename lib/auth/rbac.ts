import { ForbiddenError } from "../errors";
import type { RoleSlug } from "./constants";

export type AuthUser = {
  id: string;
  email: string;
  username: string;
  role: RoleSlug;
  status: string;
  emailVerified: Date | null;
  sessionVersion: number;
};

export function isRoleSlug(value: string): value is RoleSlug {
  return value === "customer" || value === "admin" || value === "super_admin";
}

export function hasRole(user: AuthUser, allowed: RoleSlug | RoleSlug[]): boolean {
  const list = Array.isArray(allowed) ? allowed : [allowed];
  return list.includes(user.role);
}

export function assertRole(user: AuthUser, allowed: RoleSlug | RoleSlug[]): void {
  if (!hasRole(user, allowed)) {
    throw new ForbiddenError("Insufficient role");
  }
}

export function assertSuperAdmin(user: AuthUser): void {
  assertRole(user, "super_admin");
}

export function assertAdmin(user: AuthUser): void {
  assertRole(user, ["admin", "super_admin"]);
}

/**
 * Hard rule: no administrator may manually change customer wallet balances.
 * Call this from any future admin wallet-mutation path.
 */
export function assertManualWalletMutationForbidden(): never {
  throw new ForbiddenError(
    "Administrators cannot manually increase or decrease customer wallet balances",
  );
}

export function isEmailVerified(user: AuthUser): boolean {
  return user.emailVerified !== null;
}

/**
 * Private customer actions (orders, pay, reviews, private account features).
 */
export function assertVerifiedCustomer(user: AuthUser): void {
  if (user.role !== "customer") {
    // Admins/super_admins are not customers for marketplace purchase flows.
    throw new ForbiddenError("Customer account required");
  }
  if (!isEmailVerified(user)) {
    throw new ForbiddenError("Email verification required");
  }
  if (user.status !== "active") {
    throw new ForbiddenError("Account is not active");
  }
}
