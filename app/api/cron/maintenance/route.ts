import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { authorizeCron } from "@/lib/server/cron-auth";
import { runMaintenanceJobs } from "@/lib/services/jobs/maintenance";

/**
 * Combined scheduled maintenance (Pro: every 5 minutes).
 * Auth: Authorization: Bearer <CRON_SECRET> or x-cron-secret.
 */
async function run(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;
  const data = await runMaintenanceJobs();
  return apiSuccess(data);
}

export async function GET(request: Request) {
  try {
    return await run(request);
  } catch (error) {
    return apiFromUnknownError(error, "cron.maintenance");
  }
}

export async function POST(request: Request) {
  try {
    return await run(request);
  } catch (error) {
    return apiFromUnknownError(error, "cron.maintenance");
  }
}
