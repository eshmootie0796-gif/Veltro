import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { logger } from "../logger";

/**
 * Apply SQL migrations from lib/db/migrations.
 * Usage: npx tsx lib/db/migrate.ts
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("Missing required environment variable: DATABASE_URL");
  }

  const client = postgres(url, { max: 1, prepare: false });
  const db = drizzle(client);

  logger.info("db_migrate_start");
  await migrate(db, { migrationsFolder: "./lib/db/migrations" });
  logger.info("db_migrate_complete");
  await client.end({ timeout: 5 });
}

main().catch((error: unknown) => {
  logger.error("db_migrate_failed", {
    name: error instanceof Error ? error.name : "unknown",
    message: error instanceof Error ? error.message : "unknown",
  });
  process.exitCode = 1;
});
