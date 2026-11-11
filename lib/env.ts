import { z } from "zod";

/**
 * Central environment validation.
 * All config is validated at import time. Empty strings are treated as unset.
 * Never log raw env values — secrets live here.
 */

/** Treat empty strings as unset so optional fields do not fail validation. */
const emptyToUndefined = (v: unknown) =>
  v === "" || v === undefined || v === null ? undefined : v;

const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());
const optionalEmail = z.preprocess(emptyToUndefined, z.string().email().optional());
const optionalNonEmpty = z.preprocess(emptyToUndefined, z.string().min(1).optional());
const optionalSecret = z.preprocess(emptyToUndefined, z.string().min(16).optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  /** Public application URL (Auth.js / absolute links). */
  APP_URL: optionalUrl,

  /** Neon / PostgreSQL connection string. Required for DB-backed runtime. */
  DATABASE_URL: optionalUrl,

  /** Auth.js session secret. */
  AUTH_SECRET: optionalSecret,
  AUTH_TRUST_HOST: z
    .string()
    .transform((v) => v === "true")
    .default("true"),

  /** Google OAuth (optional until enabled). */
  AUTH_GOOGLE_ID: optionalNonEmpty,
  AUTH_GOOGLE_SECRET: optionalNonEmpty,

  /** Cloudflare R2 object storage. */
  R2_ACCOUNT_ID: optionalNonEmpty,
  R2_ACCESS_KEY_ID: optionalNonEmpty,
  R2_SECRET_ACCESS_KEY: optionalNonEmpty,
  R2_BUCKET_NAME: optionalNonEmpty,
  R2_PUBLIC_URL: optionalUrl,

  /** External exchange-rate provider (single source; no fallback). */
  EXCHANGE_RATE_API_URL: optionalUrl,
  EXCHANGE_RATE_API_KEY: optionalNonEmpty,

  /** External cryptocurrency price provider (single source; no fallback). */
  CRYPTO_PRICE_API_URL: optionalUrl,
  CRYPTO_PRICE_API_KEY: optionalNonEmpty,

  /** Max age for a valid rate before pricing refuses it (ms). Default 15m. */
  RATE_MAX_AGE_MS: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),

  /** Shared secret for scheduled job / cron route handlers. */
  CRON_SECRET: optionalSecret,

  /**
   * Allow simulated_gateway + client `simulate` outcomes.
   * Default: on in development/test, off in production.
   */
  ALLOW_MOCK_PAYMENTS: z.preprocess(emptyToUndefined, z.enum(["true", "false"]).optional()).transform(
    (v) => (v === undefined ? undefined : v === "true"),
  ),

  /**
   * Return simulated email codes in auth API responses.
   * Default: on in development/test, off in production.
   */
  ALLOW_SIMULATED_AUTH_CODES: z
    .preprocess(emptyToUndefined, z.enum(["true", "false"]).optional())
    .transform((v) => (v === undefined ? undefined : v === "true")),

  /** Bootstrap Super Admin on first seed. */
  ADMIN_BOOTSTRAP_EMAIL: optionalEmail,
  ADMIN_BOOTSTRAP_PASSWORD: z.preprocess(emptyToUndefined, z.string().min(8).optional()),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;

export type Env = typeof env;

/** Assert a required env key is present; throw a safe message (no value echoed). */
export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const value = env[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required environment variable: ${String(key)}`);
  }
  return value as NonNullable<Env[K]>;
}
