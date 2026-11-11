import { env } from "../lib/env";

const requiredProd = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "CRON_SECRET",
  "APP_URL",
] as const;

function main() {
  const missing: string[] = [];
  const warnings: string[] = [];

  for (const key of requiredProd) {
    const value = env[key];
    if (value === undefined || value === null || value === "") {
      missing.push(key);
    }
  }

  if (!env.AUTH_GOOGLE_ID || !env.AUTH_GOOGLE_SECRET) {
    warnings.push("Google OAuth disabled (AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET unset)");
  }
  if (
    !env.R2_ACCOUNT_ID ||
    !env.R2_ACCESS_KEY_ID ||
    !env.R2_SECRET_ACCESS_KEY ||
    !env.R2_BUCKET_NAME
  ) {
    warnings.push("Cloudflare R2 incomplete — uploads unavailable until configured");
  }
  if (!env.EXCHANGE_RATE_API_URL) {
    warnings.push("EXCHANGE_RATE_API_URL unset — FX quotes unavailable");
  }
  if (!env.CRYPTO_PRICE_API_URL) {
    warnings.push("CRYPTO_PRICE_API_URL unset — crypto quotes unavailable");
  }

  if (missing.length > 0) {
    console.error(
      JSON.stringify({
        ok: false,
        missing,
        warnings,
        note: "Set missing vars before production deploy. Values never echoed.",
      }),
    );
    process.exit(1);
  }

  console.log(JSON.stringify({ ok: true, warnings, suite: "validate-env" }));
  process.exit(0);
}

main();
