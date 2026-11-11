import postgres from "postgres";
import { logger } from "../logger";

const REQUIRED_TABLES = [
  "roles",
  "permissions",
  "role_permissions",
  "users",
  "accounts",
  "sessions",
  "email_verification_codes",
  "password_reset_codes",
  "categories",
  "products",
  "product_variants",
  "product_field_definitions",
  "product_configs",
  "currencies",
  "exchange_rates",
  "fiat_wallets",
  "crypto_wallets",
  "crypto_wallet_balances",
  "fiat_wallet_transactions",
  "crypto_wallet_transactions",
  "crypto_reserves",
  "reserve_adjustments",
  "platform_fiat_treasury",
  "crypto_trades",
  "orders",
  "order_items",
  "order_status_history",
  "capacity_reservations",
  "payments",
  "discounts",
  "discount_reservations",
  "discount_usages",
  "notification_templates",
  "notifications",
  "reviews",
  "audit_logs",
  "system_settings",
  "background_jobs",
  "rate_feeds",
  "rate_feed_snapshots",
  "provider_statuses",
] as const;

/**
 * Smoke-check that Phase 1 tables exist after migrate.
 * Usage: npm run db:verify
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("Missing required environment variable: DATABASE_URL");
  }

  const client = postgres(url, { max: 1, prepare: false });

  const rows = await client<{ tablename: string }[]>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  `;

  const found = new Set(rows.map((r) => r.tablename));
  const missing = REQUIRED_TABLES.filter((t) => !found.has(t));

  if (missing.length > 0) {
    logger.error("db_verify_missing_tables", { missing });
    process.exitCode = 1;
  } else {
    logger.info("db_verify_ok", { tableCount: REQUIRED_TABLES.length });
  }

  await client.end({ timeout: 5 });
}

main().catch((error: unknown) => {
  logger.error("db_verify_failed", {
    name: error instanceof Error ? error.name : "unknown",
    message: error instanceof Error ? error.message : "unknown",
  });
  process.exitCode = 1;
});
