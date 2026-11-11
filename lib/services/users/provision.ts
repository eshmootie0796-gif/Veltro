import { eq } from "drizzle-orm";
import { newId } from "../../ids";
import type { DbExecutor } from "../../db/transaction";
import { cryptoWallets, fiatWallets, roles, users } from "../../db/schema";
import { ConflictError, InternalError } from "../../errors";

export type ProvisionUserInput = {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  passwordHash?: string | null;
  emailVerified?: Date | null;
  image?: string | null;
  roleSlug?: "customer" | "admin" | "super_admin";
};

/**
 * Create user + fiat wallet + crypto wallet in one transaction executor.
 * Default role is customer.
 */
export async function provisionUser(executor: DbExecutor, input: ProvisionUserInput) {
  const roleSlug = input.roleSlug ?? "customer";
  const role = await executor.query.roles.findFirst({ where: eq(roles.slug, roleSlug) });
  if (!role) {
    throw new InternalError(`Role not seeded: ${roleSlug}`);
  }

  const emailTaken = await executor.query.users.findFirst({
    where: eq(users.email, input.email.toLowerCase()),
  });
  if (emailTaken) {
    throw new ConflictError("Email already registered");
  }

  const usernameTaken = await executor.query.users.findFirst({
    where: eq(users.username, input.username.toLowerCase()),
  });
  if (usernameTaken) {
    throw new ConflictError("Username already taken");
  }

  const id = newId();
  const name = `${input.firstName} ${input.lastName}`.trim();

  await executor.insert(users).values({
    id,
    username: input.username.toLowerCase(),
    email: input.email.toLowerCase(),
    firstName: input.firstName,
    lastName: input.lastName,
    name,
    image: input.image ?? null,
    passwordHash: input.passwordHash ?? null,
    roleId: role.id,
    status: "active",
    emailVerified: input.emailVerified ?? null,
  });

  await executor.insert(fiatWallets).values({
    id: newId(),
    userId: id,
    balanceToman: 0,
  });

  await executor.insert(cryptoWallets).values({
    id: newId(),
    userId: id,
  });

  return { id, roleSlug, name };
}
