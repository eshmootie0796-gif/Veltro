import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { auditLogs, systemSettings } from "../../db/schema";
import { assertAdmin, type AuthUser } from "../../auth/rbac";
import { newId } from "../../ids";
import { parseOrThrow } from "../../validation/zod";
import { DEFAULT_TRADE_FEE_BPS, SETTINGS_KEYS } from "../../crypto/constants";
import { ValidationError } from "../../errors";

function asBps(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10000) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const n = Number(value);
    if (n >= 0 && n <= 10000) return n;
  }
  return fallback;
}

export async function getTradeFeeBps(): Promise<number> {
  const row = await db.query.systemSettings.findFirst({
    where: eq(systemSettings.key, SETTINGS_KEYS.tradeFeeBps),
  });
  return asBps(row?.value, DEFAULT_TRADE_FEE_BPS);
}

const updateSchema = z.object({
  feeBps: z.number().int().min(0).max(10000),
});

export async function updateTradeFeeBps(actor: AuthUser, raw: unknown) {
  assertAdmin(actor);
  const input = parseOrThrow(updateSchema, raw);
  if (input.feeBps < 0 || input.feeBps > 10000) {
    throw new ValidationError("feeBps out of range");
  }

  const existing = await db.query.systemSettings.findFirst({
    where: eq(systemSettings.key, SETTINGS_KEYS.tradeFeeBps),
  });
  if (existing) {
    await db
      .update(systemSettings)
      .set({ value: input.feeBps, updatedBy: actor.id, updatedAt: new Date() })
      .where(eq(systemSettings.id, existing.id));
  } else {
    await db.insert(systemSettings).values({
      id: newId(),
      key: SETTINGS_KEYS.tradeFeeBps,
      value: input.feeBps,
      updatedBy: actor.id,
    });
  }

  await db.insert(auditLogs).values({
    id: newId(),
    actorId: actor.id,
    action: "settings.crypto_trade_fee",
    entityType: "system_settings",
    entityId: SETTINGS_KEYS.tradeFeeBps,
    after: input,
  });

  return input;
}

export async function seedCryptoTradeSettings() {
  const existing = await db.query.systemSettings.findFirst({
    where: eq(systemSettings.key, SETTINGS_KEYS.tradeFeeBps),
  });
  if (!existing) {
    await db.insert(systemSettings).values({
      id: newId(),
      key: SETTINGS_KEYS.tradeFeeBps,
      value: DEFAULT_TRADE_FEE_BPS,
    });
  }
}
