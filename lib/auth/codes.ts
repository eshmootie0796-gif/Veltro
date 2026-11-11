import { randomInt } from "crypto";
import { hashOpaqueCode, safeEqualString } from "../crypto/opaque";
import { AUTH_CODE_LENGTH, AUTH_CODE_TTL_MS } from "./constants";

/** Generate a numeric simulated email code (not emailed — returned by API for this demo). */
export function generateAuthCode(): string {
  const max = 10 ** AUTH_CODE_LENGTH;
  const n = randomInt(0, max);
  return n.toString().padStart(AUTH_CODE_LENGTH, "0");
}

export function hashAuthCode(code: string): string {
  return hashOpaqueCode(code);
}

export function authCodeMatches(code: string, codeHash: string): boolean {
  return safeEqualString(hashAuthCode(code), codeHash);
}

export function authCodeExpiresAt(from = new Date()): Date {
  return new Date(from.getTime() + AUTH_CODE_TTL_MS);
}
