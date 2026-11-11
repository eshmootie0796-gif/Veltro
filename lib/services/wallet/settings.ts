import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { auditLogs, systemSettings } from "../../db/schema";
import { assertAdmin, type AuthUser } from "../../auth/rbac";
import { newId } from "../../ids";
import { parseOrThrow, zToman } from "../../validation/zod";
import {
  DEFAULT_TOPUP_MAX_TOMAN,
  DEFAULT_TOPUP_MIN_TOMAN,
  SETTINGS_KEYS,
} from "../../payments/constants";
import { ValidationError } from "../../errors";

function asPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return fallback;
}

export async function getTopupLimits() {
  const rows = await db.query.systemSettings.findMany();
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const minToman = asPositiveInt(map.get(SETTINGS_KEYS.topupMinToman), DEFAULT_TOPUP_MIN_TOMAN);
  const maxToman = asPositiveInt(map.get(SETTINGS_KEYS.topupMaxToman), DEFAULT_TOPUP_MAX_TOMAN);
  return { minToman, maxToman };
}

const updateSchema = z.object({
  minToman: zToman.min(1),
  maxToman: zToman.min(1),
});

export async function updateTopupLimits(actor: AuthUser, raw: unknown) {
  assertAdmin(actor);
  const input = parseOrThrow(updateSchema, raw);
  if (input.minToman > input.maxToman) {
    throw new ValidationError("minToman cannot exceed maxToman");
  }

  await upsertSetting(SETTINGS_KEYS.topupMinToman, input.minToman, actor.id);
  await upsertSetting(SETTINGS_KEYS.topupMaxToman, input.maxToman, actor.id);

  await db.insert(auditLogs).values({
    id: newId(),
    actorId: actor.id,
    action: "settings.wallet_topup_limits",
    entityType: "system_settings",
    entityId: "wallet.topup",
    after: input,
  });

  return input;
}

async function upsertSetting(key: string, value: number, actorId: string) {
  const existing = await db.query.systemSettings.findFirst({
    where: eq(systemSettings.key, key),
  });
  if (existing) {
    await db
      .update(systemSettings)
      .set({ value, updatedBy: actorId, updatedAt: new Date() })
      .where(eq(systemSettings.id, existing.id));
    return;
  }
  await db.insert(systemSettings).values({
    id: newId(),
    key,
    value,
    updatedBy: actorId,
  });
}

export async function seedWalletTopupSettings() {
  const existingMin = await db.query.systemSettings.findFirst({
    where: eq(systemSettings.key, SETTINGS_KEYS.topupMinToman),
  });
  if (!existingMin) {
    await db.insert(systemSettings).values({
      id: newId(),
      key: SETTINGS_KEYS.topupMinToman,
      value: DEFAULT_TOPUP_MIN_TOMAN,
    });
  }
  const existingMax = await db.query.systemSettings.findFirst({
    where: eq(systemSettings.key, SETTINGS_KEYS.topupMaxToman),
  });
  if (!existingMax) {
    await db.insert(systemSettings).values({
      id: newId(),
      key: SETTINGS_KEYS.topupMaxToman,
      value: DEFAULT_TOPUP_MAX_TOMAN,
    });
  }
}
