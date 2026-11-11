import "server-only";

import { apiError } from "../api/response";
import { assertCronSecret } from "./sensitive";

/** Header-only cron auth. Never accept secrets via query string (log leakage). */
export function authorizeCron(request: Request) {
  const header =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.headers.get("x-cron-secret");
  if (!assertCronSecret(header)) {
    return apiError("UNAUTHORIZED", "Invalid cron secret", { status: 401 });
  }
  return null;
}
