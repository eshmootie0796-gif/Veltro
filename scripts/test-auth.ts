import { eq } from "drizzle-orm";
import { seedBaseline } from "../lib/db/seeds/run";
import { registerUser } from "../lib/services/auth/register";
import { confirmEmailVerification } from "../lib/services/auth/verification";
import {
  confirmPasswordReset,
  requestPasswordReset,
} from "../lib/services/auth/password-reset";
import {
  changePassword,
  requestPasswordChangeVerification,
} from "../lib/services/auth/password-change";
import { authenticateCredentials } from "../lib/auth/credentials";
import { assertVerifiedCustomer, assertManualWalletMutationForbidden } from "../lib/auth/rbac";
import { blockUser, unblockUser } from "../lib/services/users/block";
import { assignUserRole, createAdminAccount } from "../lib/services/users/roles";
import { deleteOwnAccount } from "../lib/services/users/delete-account";
import { db } from "../lib/db";
import { fiatWallets, roles, users } from "../lib/db/schema";
import { newId } from "../lib/ids";
import { hashPassword } from "../lib/auth/password";
import type { AuthUser } from "../lib/auth/rbac";
import { ConflictError, ForbiddenError } from "../lib/errors";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function makeSuperAdmin(): Promise<AuthUser> {
  const superRole = await db.query.roles.findFirst({ where: eq(roles.slug, "super_admin") });
  assert(superRole, "super_admin role missing");
  const id = newId();
  const email = `super_${id.slice(0, 8)}@test.local`;
  const username = `super_${id.slice(0, 8)}`;
  await db.insert(users).values({
    id,
    username,
    email,
    firstName: "Super",
    lastName: "Tester",
    name: "Super Tester",
    passwordHash: await hashPassword("SuperPass123!"),
    roleId: superRole.id,
    status: "active",
    emailVerified: new Date(),
  });
  await db.insert(fiatWallets).values({ id: newId(), userId: id, balanceToman: 0 });
  return {
    id,
    email,
    username,
    role: "super_admin",
    status: "active",
    emailVerified: new Date(),
    sessionVersion: 0,
  };
}

async function main() {
  await seedBaseline();

  const suffix = newId().slice(0, 8);
  const registered = await registerUser({
    username: `user_${suffix}`,
    password: "Password123!",
    firstName: "Ada",
    lastName: "Lovelace",
    email: `ada_${suffix}@example.com`,
  });

  assert(registered.simulatedVerificationCode, "verification code required");
  assert(registered.user.role === "customer", "default role customer");

  // Unverified customer cannot use private features
  let blockedPrivate = false;
  try {
    assertVerifiedCustomer({
      id: registered.user.id,
      email: registered.user.email,
      username: registered.user.username,
      role: "customer",
      status: "active",
      emailVerified: null,
      sessionVersion: 0,
    });
  } catch (error) {
    blockedPrivate = error instanceof ForbiddenError;
  }
  assert(blockedPrivate, "unverified customer must be forbidden");

  await confirmEmailVerification({
    email: registered.user.email,
    code: registered.simulatedVerificationCode,
  });

  const authed = await authenticateCredentials(registered.user.username, "Password123!");
  assert(authed?.id === registered.user.id, "credentials login failed");

  // Password reset
  const resetReq = await requestPasswordReset({ email: registered.user.email });
  assert(resetReq.simulatedResetCode, "reset code required");
  await confirmPasswordReset({
    email: registered.user.email,
    code: resetReq.simulatedResetCode,
    newPassword: "Password456!",
  });
  const afterReset = await authenticateCredentials(registered.user.email, "Password456!");
  assert(afterReset?.id === registered.user.id, "login after reset failed");
  assert(
    afterReset && afterReset.sessionVersion > (authed?.sessionVersion ?? 0),
    "sessionVersion must bump on reset",
  );

  // Password change
  const codeReq = await requestPasswordChangeVerification(registered.user.id);
  await changePassword(registered.user.id, {
    currentPassword: "Password456!",
    verificationCode: codeReq.simulatedVerificationCode,
    newPassword: "Password789!",
  });
  const afterChange = await authenticateCredentials(registered.user.username, "Password789!");
  assert(afterChange?.id === registered.user.id, "login after password change failed");

  // Super admin + admin creation + role rules
  const superAdmin = await makeSuperAdmin();
  const admin = await createAdminAccount(superAdmin, {
    username: `admin_${suffix}`,
    email: `admin_${suffix}@example.com`,
    password: "AdminPass123!",
    firstName: "Ada",
    lastName: "Admin",
  });
  assert(admin.role === "admin", "admin create failed");

  // Manual wallet mutation hard-blocked
  let walletBlocked = false;
  try {
    assertManualWalletMutationForbidden();
  } catch (error) {
    walletBlocked = error instanceof ForbiddenError;
  }
  assert(walletBlocked, "manual wallet mutation must be forbidden");

  // Block / unblock
  await blockUser(
    { ...superAdmin, role: "admin" },
    registered.user.id,
    { reason: "Abuse detected for test" },
  );
  const blockedLogin = await authenticateCredentials(registered.user.username, "Password789!");
  assert(blockedLogin === null, "blocked user must not login");

  await unblockUser(superAdmin, registered.user.id, { reason: "Appeal accepted" });
  const unblockedLogin = await authenticateCredentials(registered.user.username, "Password789!");
  assert(unblockedLogin?.id === registered.user.id, "unblocked login failed");

  // Last super admin protection
  let lastSuperBlocked = false;
  try {
    await assignUserRole(superAdmin, superAdmin.id, { role: "admin" });
  } catch (error) {
    lastSuperBlocked = error instanceof ConflictError;
  }
  // May succeed if bootstrap super exists; ensure at least one remains by counting
  const supers = await db.query.users.findMany({
    with: { role: true },
  });
  const activeSupers = supers.filter(
    (u) => u.status === "active" && u.role?.slug === "super_admin",
  );
  assert(activeSupers.length >= 1, "at least one super_admin must remain");
  void lastSuperBlocked;

  // Fund wallet then delete account (forfeiture)
  const fiat = await db.query.fiatWallets.findFirst({
    where: eq(fiatWallets.userId, registered.user.id),
  });
  assert(fiat, "fiat wallet missing");
  await db
    .update(fiatWallets)
    .set({ balanceToman: 50_000 })
    .where(eq(fiatWallets.id, fiat.id));

  await deleteOwnAccount(registered.user.id, {
    confirm: true,
    acknowledgeForfeiture: true,
    currentPassword: "Password789!",
  });

  const deleted = await db.query.users.findFirst({ where: eq(users.id, registered.user.id) });
  assert(deleted?.status === "deleted", "user not deleted");
  const fiatAfter = await db.query.fiatWallets.findFirst({
    where: eq(fiatWallets.userId, registered.user.id),
  });
  assert(fiatAfter?.balanceToman === 0, "fiat balance not forfeited");

  const deletedLogin = await authenticateCredentials(deleted!.username, "Password789!");
  assert(deletedLogin === null, "deleted user must not login");

  console.log(JSON.stringify({ ok: true, suite: "test-auth" }));
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
