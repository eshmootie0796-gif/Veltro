import "server-only";

/**
 * Server-only surface for sensitive helpers.
 * Importing this module from a Client Component will fail the Next.js build.
 */

import { hashOpaqueCode, safeEqualString } from "../crypto/opaque";
import { requireEnv } from "../env";

export { hashOpaqueCode, safeEqualString };

/** Authorize a cron request via shared CRON_SECRET. */
export function assertCronSecret(provided: string | null | undefined): boolean {
  const expected = requireEnv("CRON_SECRET");
  if (!provided) return false;
  return safeEqualString(provided, expected);
}
