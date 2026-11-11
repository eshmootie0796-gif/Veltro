import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { authorizeCron } from "@/lib/server/cron-auth";
import { checkRateProviders } from "@/lib/services/jobs/maintenance";
import { DEFAULT_RATE_CHECK_INTERVAL_MS } from "@/lib/pricing/constants";

/**
 * Refresh FX + crypto feeds and record provider health.
 * Marks providers unavailable on failure (no stale-rate reuse).
 */
async function run(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;
  const data = await checkRateProviders();
  return apiSuccess({
    ...data,
    recommendedIntervalMs: DEFAULT_RATE_CHECK_INTERVAL_MS,
  });
}

export async function GET(request: Request) {
  try {
    return await run(request);
  } catch (error) {
    return apiFromUnknownError(error, "cron.refresh_rates");
  }
}

export async function POST(request: Request) {
  try {
    return await run(request);
  } catch (error) {
    return apiFromUnknownError(error, "cron.refresh_rates");
  }
}
