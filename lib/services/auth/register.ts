import { z } from "zod";
import { withTransaction } from "../../db/transaction";
import { parseOrThrow, zEmail, zNonEmpty } from "../../validation/zod";
import { hashPassword } from "../../auth/password";
import { simulatedAuthCodesExposed } from "../../payments/mock-gate";
import { provisionUser } from "../users/provision";
import { issueEmailVerificationCode } from "./verification";

export const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(32)
    .regex(/^[a-z0-9_]+$/, "Username may contain letters, numbers, and underscores only"),
  password: z.string().min(8).max(128),
  firstName: zNonEmpty.max(80),
  lastName: zNonEmpty.max(80),
  email: zEmail,
});

export type RegisterInput = z.infer<typeof registerSchema>;

export async function registerUser(raw: unknown) {
  const input = parseOrThrow(registerSchema, raw);
  const passwordHash = await hashPassword(input.password);

  const result = await withTransaction(async (tx) => {
    const user = await provisionUser(tx, {
      username: input.username,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      passwordHash,
      emailVerified: null,
      roleSlug: "customer",
    });

    const verification = await issueEmailVerificationCode(tx, user.id);
    return { user, verification };
  });

  return {
    user: {
      id: result.user.id,
      username: input.username,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      role: result.user.roleSlug,
      emailVerified: false,
    },
    verificationExpiresAt: result.verification.expiresAt.toISOString(),
    /** Simulated email channel — omitted in production unless ALLOW_SIMULATED_AUTH_CODES. */
    simulatedVerificationCode: simulatedAuthCodesExposed()
      ? result.verification.code
      : undefined,
  };
}
