import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { passwordResetCodes, users } from "../../db/schema";
import { authCodeExpiresAt, authCodeMatches, generateAuthCode, hashAuthCode } from "../../auth/codes";
import { hashPassword } from "../../auth/password";
import { newId } from "../../ids";
import { ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { parseOrThrow, zEmail, zNonEmpty } from "../../validation/zod";
import { simulatedAuthCodesExposed } from "../../payments/mock-gate";

export const requestPasswordResetSchema = z.object({
  email: zEmail,
});

export async function requestPasswordReset(raw: unknown) {
  const { email } = parseOrThrow(requestPasswordResetSchema, raw);
  const user = await db.query.users.findFirst({ where: eq(users.email, email.toLowerCase()) });

  // Uniform response shape — no existence oracle via resetExpiresAt presence.
  const opaqueExpiresAt = authCodeExpiresAt().toISOString();

  if (!user || user.status === "deleted" || !user.passwordHash || user.status === "blocked") {
    return {
      accepted: true as const,
      resetExpiresAt: opaqueExpiresAt,
      simulatedResetCode: undefined as string | undefined,
    };
  }

  const code = generateAuthCode();
  const expiresAt = authCodeExpiresAt();
  await db.insert(passwordResetCodes).values({
    id: newId(),
    userId: user.id,
    codeHash: hashAuthCode(code),
    expiresAt,
  });

  return {
    accepted: true as const,
    resetExpiresAt: expiresAt.toISOString(),
    simulatedResetCode: simulatedAuthCodesExposed() ? code : undefined,
  };
}

export const confirmPasswordResetSchema = z.object({
  email: zEmail,
  code: zNonEmpty.length(8),
  newPassword: z.string().min(8).max(128),
});

export async function confirmPasswordReset(raw: unknown) {
  const input = parseOrThrow(confirmPasswordResetSchema, raw);
  const user = await db.query.users.findFirst({
    where: eq(users.email, input.email.toLowerCase()),
  });
  if (!user || user.status === "deleted") {
    throw new NotFoundError("User not found");
  }
  if (user.status === "blocked") {
    throw new ForbiddenError("Account is blocked");
  }

  const latest = await db.query.passwordResetCodes.findFirst({
    where: and(eq(passwordResetCodes.userId, user.id), isNull(passwordResetCodes.consumedAt)),
    orderBy: [desc(passwordResetCodes.createdAt)],
  });

  if (!latest) {
    throw new ValidationError("No active reset code");
  }
  if (latest.expiresAt.getTime() < Date.now()) {
    throw new ValidationError("Reset code expired");
  }
  if (!authCodeMatches(input.code, latest.codeHash)) {
    throw new ValidationError("Invalid reset code");
  }

  const passwordHash = await hashPassword(input.newPassword);

  await db.transaction(async (tx) => {
    await tx
      .update(passwordResetCodes)
      .set({ consumedAt: new Date() })
      .where(eq(passwordResetCodes.id, latest.id));
    await tx
      .update(users)
      .set({
        passwordHash,
        // Invalidate all sessions after password reset.
        sessionVersion: user.sessionVersion + 1,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));
  });

  return { passwordReset: true as const };
}
