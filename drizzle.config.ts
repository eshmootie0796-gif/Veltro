import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env" });

/**
 * Drizzle Kit config. Loads `.env` for DATABASE_URL.
 * Prefer Neon in production; local docker-compose works for development.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema/index.ts",
  out: "./lib/db/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
