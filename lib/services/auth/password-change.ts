import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { emailVerificationCodes, users } from "../../db/schema";
import { authCodeMatches } from "../../auth/codes";
import { hashPassword, verifyPassword } from "../../auth/password";
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "../../errors";
import { parseOrThrow, zNonEmpty } from "../../validation/zod";
import { simulatedAuthCodesExposed } from "../../payments/mock-gate";
import { issueEmailVerificationCode } from "./verification";

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  verificationCode: zNonEmpty.length(8),
  newPassword: z.string().min(8).max(128),
});

/**
 * Password change requires current password + a valid simulated email verification code.
 */
export async function changePassword(userId: string, raw: unknown) {
  const input = parseOrThrow(passwordChangeSchema, raw);
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user || user.status === "deleted") {
    throw new NotFoundError("User not found");
  }
  if (user.status === "blocked") {
    throw new ForbiddenError("Account is blocked");
  }
  if (!user.passwordHash) {
    throw new ValidationError("Password login is not configured for this account");
  }

  const currentOk = await verifyPassword(user.passwordHash, input.currentPassword);
  if (!currentOk) {
    throw new UnauthorizedError("Current password is incorrect");
  }

  const latest = await db.query.emailVerificationCodes.findFirst({
    where: and(
      eq(emailVerificationCodes.userId, user.id),
      isNull(emailVerificationCodes.consumedAt),
    ),
    orderBy: [desc(emailVerificationCodes.createdAt)],
  });

  if (!latest) {
    throw new ValidationError("No active verification code");
  }
  if (latest.expiresAt.getTime() < Date.now()) {
    throw new ValidationError("Verification code expired");
  }
  if (!authCodeMatches(input.verificationCode, latest.codeHash)) {
    throw new ValidationError("Invalid verification code");
  }

  const passwordHash = await hashPassword(input.newPassword);

  await db.transaction(async (tx) => {
    await tx
      .update(emailVerificationCodes)
      .set({ consumedAt: new Date() })
      .where(eq(emailVerificationCodes.id, latest.id));
    await tx
      .update(users)
      .set({
        passwordHash,
        sessionVersion: user.sessionVersion + 1,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));
  });

  return { passwordChanged: true as const };
}

/** Issue a fresh verification code for password-change flow (simulated email). */
export async function requestPasswordChangeVerification(userId: string) {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user || user.status !== "active") {
    throw new ForbiddenError("Account is not active");
  }
  const { code, expiresAt } = await issueEmailVerificationCode(db, userId);
  return {
    verificationExpiresAt: expiresAt.toISOString(),
    simulatedVerificationCode: simulatedAuthCodesExposed() ? code : undefined,
  };
}
