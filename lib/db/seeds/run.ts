import { eq } from "drizzle-orm";
import { db } from "../index";
import {
  roles,
  categories,
  currencies,
  users,
  fiatWallets,
  cryptoWallets,
} from "../schema";
import { CATEGORY_SEEDS, CURRENCY_SEEDS, ROLE_SEEDS } from "./constants";
import { newId } from "../../ids";
import { logger } from "../../logger";
import { hashPassword } from "../../auth/password";
import { env } from "../../env";
import { seedLockedCatalog } from "../../services/catalog/seed-catalog";
import { seedWalletTopupSettings } from "../../services/wallet/settings";
import { seedCryptoTradingInfrastructure } from "../../services/crypto/seed";
import { seedNotificationTemplates } from "../../services/notifications/service";

/**
 * Idempotent seed for roles, categories, currencies, and optional bootstrap super_admin.
 */
export async function seedBaseline() {
  for (const role of ROLE_SEEDS) {
    const existing = await db.query.roles.findFirst({ where: eq(roles.slug, role.slug) });
    if (existing) continue;
    await db.insert(roles).values({
      id: newId(),
      slug: role.slug,
      name: role.name,
      description: role.description,
      isSystem: true,
    });
  }

  for (const category of CATEGORY_SEEDS) {
    const existing = await db.query.categories.findFirst({
      where: eq(categories.slug, category.slug),
    });
    if (existing) continue;
    await db.insert(categories).values({
      id: newId(),
      slug: category.slug,
      name: category.name,
      sortOrder: category.sortOrder,
      isActive: true,
    });
  }

  for (const currency of CURRENCY_SEEDS) {
    const existing = await db.query.currencies.findFirst({
      where: eq(currencies.code, currency.code),
    });
    if (existing) continue;
    await db.insert(currencies).values({
      id: newId(),
      code: currency.code,
      name: currency.name,
      kind: currency.kind,
      decimals: currency.decimals,
      isActive: true,
    });
  }

  if (env.ADMIN_BOOTSTRAP_EMAIL && env.ADMIN_BOOTSTRAP_PASSWORD) {
    await seedBootstrapSuperAdmin(env.ADMIN_BOOTSTRAP_EMAIL, env.ADMIN_BOOTSTRAP_PASSWORD);
  }

  await seedLockedCatalog();
  await seedWalletTopupSettings();
  await seedCryptoTradingInfrastructure();
  await seedNotificationTemplates();

  logger.info("seed_baseline_complete");
}

async function seedBootstrapSuperAdmin(email: string, password: string) {
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) return;

  const superRole = await db.query.roles.findFirst({ where: eq(roles.slug, "super_admin") });
  if (!superRole) throw new Error("super_admin role missing");

  const userId = newId();
  const username = `superadmin_${userId.slice(0, 8)}`;

  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id: userId,
      username,
      email: email.toLowerCase(),
      firstName: "Super",
      lastName: "Admin",
      name: "Super Admin",
      passwordHash: await hashPassword(password),
      roleId: superRole.id,
      status: "active",
      emailVerified: new Date(),
    });
    await tx.insert(fiatWallets).values({ id: newId(), userId, balanceToman: 0 });
    await tx.insert(cryptoWallets).values({ id: newId(), userId });
  });

  logger.info("seed_bootstrap_super_admin", { userId });
}
