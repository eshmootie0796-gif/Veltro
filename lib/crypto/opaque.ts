import { createHash, timingSafeEqual } from "crypto";

/** Hash a short-lived verification/reset code for at-rest storage. */
export function hashOpaqueCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** Constant-time string compare for secrets (same length required). */
export function safeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}
