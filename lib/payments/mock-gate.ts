import { env } from "../env";
import { ForbiddenError } from "../errors";

/**
 * Mock gateway + client `simulate` knobs are for local/test only.
 * Production requires ALLOW_MOCK_PAYMENTS=true explicitly (never default).
 */
export function mockPaymentsAllowed(): boolean {
  if (env.ALLOW_MOCK_PAYMENTS === true) return true;
  if (env.ALLOW_MOCK_PAYMENTS === false) return false;
  return env.NODE_ENV !== "production";
}

export function assertMockPaymentsAllowed(context: string): void {
  if (!mockPaymentsAllowed()) {
    throw new ForbiddenError(`Mock payments disabled (${context})`);
  }
}

/** Simulated email codes in API bodies — never in production unless explicitly allowed. */
export function simulatedAuthCodesExposed(): boolean {
  if (env.ALLOW_SIMULATED_AUTH_CODES === true) return true;
  if (env.ALLOW_SIMULATED_AUTH_CODES === false) return false;
  return env.NODE_ENV !== "production";
}
