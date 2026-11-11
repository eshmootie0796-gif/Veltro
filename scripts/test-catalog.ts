import { eq } from "drizzle-orm";
import { seedBaseline } from "../lib/db/seeds/run";
import { AI_SERVICE_CATALOG, PAYPAL_SERVICE_CATALOG } from "../lib/catalog/constants";
import { validateDynamicFieldValues } from "../lib/catalog/field-validation";
import { createProduct, deleteProduct, listPublicProducts } from "../lib/services/catalog/products";
import { createVariant } from "../lib/services/catalog/variants";
import { validateProductFieldValues } from "../lib/services/catalog/fields";
import { db } from "../lib/db";
import { products, roles, users } from "../lib/db/schema";
import { newId } from "../lib/ids";
import { hashPassword } from "../lib/auth/password";
import type { AuthUser } from "../lib/auth/rbac";
import { ForbiddenError, ValidationError } from "../lib/errors";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function makeAdmin(): Promise<AuthUser> {
  const role = await db.query.roles.findFirst({ where: eq(roles.slug, "admin") });
  assert(role, "admin role missing");
  const id = newId();
  await db.insert(users).values({
    id,
    username: `catadmin_${id.slice(0, 8)}`,
    email: `catadmin_${id.slice(0, 8)}@test.local`,
    firstName: "Cat",
    lastName: "Admin",
    name: "Cat Admin",
    passwordHash: await hashPassword("AdminPass123!"),
    roleId: role.id,
    status: "active",
    emailVerified: new Date(),
  });
  return {
    id,
    email: `catadmin_${id.slice(0, 8)}@test.local`,
    username: `catadmin_${id.slice(0, 8)}`,
    role: "admin",
    status: "active",
    emailVerified: new Date(),
    sessionVersion: 0,
  };
}

async function main() {
  await seedBaseline();

  const aiCount = await db.query.products.findMany({
    where: eq(products.isCatalogLocked, true),
  });
  assert(
    aiCount.length >= AI_SERVICE_CATALOG.length + PAYPAL_SERVICE_CATALOG.length,
    "locked catalog not seeded",
  );

  const admin = await makeAdmin();

  let blockedAiCreate = false;
  try {
    await createProduct(admin, {
      categorySlug: "ai-subscriptions",
      title: "Fake AI",
      slug: `fake-ai-${newId().slice(0, 6)}`,
      config: {
        group: "assistants",
        personalAccountOnly: true,
        neverCollectPassword: true,
        noSharedAccounts: true,
      },
    });
  } catch (error) {
    blockedAiCreate = error instanceof ForbiddenError;
  }
  assert(blockedAiCreate, "AI arbitrary create must be forbidden");

  const gift = await createProduct(admin, {
    categorySlug: "gift-cards-premium",
    title: "Steam Wallet",
    slug: `steam-${newId().slice(0, 6)}`,
    description: "Steam gift card",
    config: {
      brand: "Steam",
      countryOrRegion: "Global",
      productType: "gift_card",
      supportsStarsQuantity: false,
      supportsSubscriptionDuration: false,
      denominations: [10, 20, 50],
    },
  });
  assert(gift.id, "gift product create failed");

  const variant = await createVariant(admin, gift.id, {
    name: "20 USD",
    priceToman: 1_200_000,
    capacityMode: "finite",
    capacityTotal: 100,
    capacityRemaining: 100,
  });
  assert(variant.capacityMode === "finite", "finite capacity not set");

  const chatgpt = await db.query.products.findFirst({
    where: eq(products.catalogKey, "ai.chatgpt"),
  });
  assert(chatgpt, "chatgpt missing");
  const validated = await validateProductFieldValues(chatgpt.id, {
    account_email: "user@example.com",
  });
  assert(validated.account_email === "user@example.com", "ai email validation failed");

  let badEmail = false;
  try {
    await validateProductFieldValues(chatgpt.id, { account_email: "not-an-email" });
  } catch (error) {
    badEmail = error instanceof ValidationError;
  }
  assert(badEmail, "invalid email must fail");

  // Never allow password field smuggling on AI
  let unknownField = false;
  try {
    await validateProductFieldValues(chatgpt.id, {
      account_email: "user@example.com",
      password: "secret",
    });
  } catch (error) {
    unknownField = error instanceof ValidationError;
  }
  assert(unknownField, "unknown password field must be rejected");

  validateDynamicFieldValues(
    [
      {
        key: "qty",
        labelEn: "Qty",
        labelFa: "تعداد",
        fieldType: "number",
        options: [],
        isRequired: true,
        validation: { min: 1, max: 5 },
        visibility: null,
      },
    ],
    { qty: 3 },
  );

  const listed = await listPublicProducts({ page: "1", pageSize: "50", category: "gift-cards-premium" });
  assert(listed.items.some((p) => p.id === gift.id), "public list missing gift product");

  const deleted = await deleteProduct(admin, gift.id);
  assert(deleted.mode === "hard" || deleted.mode === "soft", "delete failed");

  console.log(
    JSON.stringify({
      ok: true,
      suite: "test-catalog",
      lockedProducts: aiCount.length,
    }),
  );
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
