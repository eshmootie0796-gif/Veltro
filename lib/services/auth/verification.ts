import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import type { DbExecutor } from "../../db/transaction";
import { emailVerificationCodes, users } from "../../db/schema";
import { authCodeExpiresAt, authCodeMatches, generateAuthCode, hashAuthCode } from "../../auth/codes";
import { newId } from "../../ids";
import { NotFoundError, ValidationError, ForbiddenError } from "../../errors";
import { parseOrThrow, zEmail, zNonEmpty } from "../../validation/zod";
import { simulatedAuthCodesExposed } from "../../payments/mock-gate";

export async function issueEmailVerificationCode(executor: DbExecutor, userId: string) {
  const code = generateAuthCode();
  const expiresAt = authCodeExpiresAt();

  await executor.insert(emailVerificationCodes).values({
    id: newId(),
    userId,
    codeHash: hashAuthCode(code),
    expiresAt,
  });

  return { code, expiresAt };
}

export const requestVerificationSchema = z.object({
  email: zEmail,
});

export async function requestEmailVerification(raw: unknown) {
  const { email } = parseOrThrow(requestVerificationSchema, raw);
  const user = await db.query.users.findFirst({ where: eq(users.email, email.toLowerCase()) });

  // Uniform acceptance — no alreadyVerified / existence oracle.
  if (!user || user.status === "deleted" || user.emailVerified) {
    return {
      accepted: true as const,
      verificationExpiresAt: authCodeExpiresAt().toISOString(),
      simulatedVerificationCode: undefined as string | undefined,
    };
  }

  const { code, expiresAt } = await issueEmailVerificationCode(db, user.id);
  return {
    accepted: true as const,
    verificationExpiresAt: expiresAt.toISOString(),
    simulatedVerificationCode: simulatedAuthCodesExposed() ? code : undefined,
  };
}

export const confirmVerificationSchema = z.object({
  email: zEmail,
  code: zNonEmpty.length(8),
});

export async function confirmEmailVerification(raw: unknown) {
  const input = parseOrThrow(confirmVerificationSchema, raw);
  const user = await db.query.users.findFirst({
    where: eq(users.email, input.email.toLowerCase()),
  });
  if (!user || user.status === "deleted") {
    throw new NotFoundError("User not found");
  }
  if (user.status === "blocked") {
    throw new ForbiddenError("Account is blocked");
  }
  if (user.emailVerified) {
    return { emailVerified: true as const };
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
  if (!authCodeMatches(input.code, latest.codeHash)) {
    throw new ValidationError("Invalid verification code");
  }

  await db.transaction(async (tx) => {
    await tx
      .update(emailVerificationCodes)
      .set({ consumedAt: new Date() })
      .where(eq(emailVerificationCodes.id, latest.id));
    await tx
      .update(users)
      .set({ emailVerified: new Date(), updatedAt: new Date() })
      .where(eq(users.id, user.id));
  });

  return { emailVerified: true as const };
}
