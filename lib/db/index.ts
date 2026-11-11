import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { requireEnv } from "../env";

export type Database = PostgresJsDatabase<typeof schema>;

/** Keep a single pool per serverless warm tier. */
const globalForDb = globalThis as unknown as {
  sql?: ReturnType<typeof postgres>;
  db?: Database;
};

function createClient() {
  const connectionString = requireEnv("DATABASE_URL");
  // max: 1 suits Neon + Vercel serverless connection patterns
  const fallback =
    process.env.VERCEL || process.env.NODE_ENV === "production" ? "1" : "8";
  const max = Math.max(1, Number(process.env.DB_POOL_MAX ?? fallback) || 1);
  return postgres(connectionString, {
    max,
    prepare: false,
  });
}

const client = globalForDb.sql ?? createClient();
const dbInstance = globalForDb.db ?? drizzle(client, { schema });

if (process.env.NODE_ENV !== "production") {
  globalForDb.sql = client;
  globalForDb.db = dbInstance;
}

export const db: Database = dbInstance;
export { schema };
