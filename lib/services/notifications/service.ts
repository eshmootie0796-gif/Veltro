import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  notificationTemplates,
  notifications,
  systemSettings,
} from "../../db/schema";
import type { AuthUser } from "../../auth/rbac";
import { assertAdmin, assertVerifiedCustomer } from "../../auth/rbac";
import { ForbiddenError, NotFoundError } from "../../errors";
import { newId } from "../../ids";
import { parseOrThrow, zNonEmpty } from "../../validation/zod";
import {
  DEFAULT_SERVICE_FEE_BPS,
  NOTIFICATION_TEMPLATE_SEEDS,
  SETTINGS_KEYS,
  type NotificationType,
} from "../../notifications/constants";
import { writeAuditLog } from "../audit/write";

function renderTemplate(template: string, vars: Record<string, string | number>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    vars[key] !== undefined ? String(vars[key]) : "",
  );
}

export async function seedNotificationTemplates() {
  for (const seed of NOTIFICATION_TEMPLATE_SEEDS) {
    const existing = await db.query.notificationTemplates.findFirst({
      where: eq(notificationTemplates.slug, seed.slug),
    });
    if (existing) continue;
    await db.insert(notificationTemplates).values({
      id: newId(),
      slug: seed.slug,
      channel: "in_app",
      titleTemplate: seed.titleTemplate,
      bodyTemplate: seed.bodyTemplate,
    });
  }

  const fee = await db.query.systemSettings.findFirst({
    where: eq(systemSettings.key, SETTINGS_KEYS.defaultServiceFeeBps),
  });
  if (!fee) {
    await db.insert(systemSettings).values({
      id: newId(),
      key: SETTINGS_KEYS.defaultServiceFeeBps,
      value: DEFAULT_SERVICE_FEE_BPS,
    });
  }
  const enabled = await db.query.systemSettings.findFirst({
    where: eq(systemSettings.key, SETTINGS_KEYS.notificationsEnabled),
  });
  if (!enabled) {
    await db.insert(systemSettings).values({
      id: newId(),
      key: SETTINGS_KEYS.notificationsEnabled,
      value: true,
    });
  }
}

async function notificationsEnabled(): Promise<boolean> {
  const row = await db.query.systemSettings.findFirst({
    where: eq(systemSettings.key, SETTINGS_KEYS.notificationsEnabled),
  });
  if (row?.value === false) return false;
  return true;
}

export async function notifyUser(input: {
  userId: string;
  type: NotificationType | string;
  vars?: Record<string, string | number>;
  data?: Record<string, unknown>;
  title?: string;
  body?: string;
}) {
  if (!(await notificationsEnabled())) return null;

  const template = await db.query.notificationTemplates.findFirst({
    where: eq(notificationTemplates.slug, input.type),
  });
  const vars = input.vars ?? {};
  const title =
    input.title ??
    (template ? renderTemplate(template.titleTemplate, vars) : input.type);
  const body =
    input.body ??
    (template ? renderTemplate(template.bodyTemplate, vars) : null);

  const id = newId();
  await db.insert(notifications).values({
    id,
    userId: input.userId,
    templateId: template?.id ?? null,
    type: input.type,
    title,
    body,
    data: input.data ?? vars,
  });
  return id;
}

export async function listMyNotifications(user: AuthUser, limit = 50, unreadOnly = false) {
  assertVerifiedCustomer(user);
  const rows = await db.query.notifications.findMany({
    where: unreadOnly
      ? and(eq(notifications.userId, user.id), isNull(notifications.readAt))
      : eq(notifications.userId, user.id),
    orderBy: [desc(notifications.createdAt)],
    limit: Math.min(Math.max(limit, 1), 100),
  });
  return rows.map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    data: n.data,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  }));
}

export async function markNotificationRead(user: AuthUser, notificationId: string) {
  assertVerifiedCustomer(user);
  const row = await db.query.notifications.findFirst({
    where: and(eq(notifications.id, notificationId), eq(notifications.userId, user.id)),
  });
  if (!row) throw new NotFoundError("Notification not found");
  if (!row.readAt) {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(eq(notifications.id, notificationId));
  }
  return { id: notificationId, read: true };
}

export async function markAllNotificationsRead(user: AuthUser) {
  assertVerifiedCustomer(user);
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
  return { ok: true };
}

export async function listNotificationTemplates(actor: AuthUser) {
  assertAdmin(actor);
  return db.query.notificationTemplates.findMany();
}

const updateTemplateSchema = z.object({
  titleTemplate: zNonEmpty.max(200),
  bodyTemplate: zNonEmpty.max(2000),
});

export async function updateNotificationTemplate(
  actor: AuthUser,
  slug: string,
  raw: unknown,
) {
  assertAdmin(actor);
  const input = parseOrThrow(updateTemplateSchema, raw);
  const existing = await db.query.notificationTemplates.findFirst({
    where: eq(notificationTemplates.slug, slug),
  });
  if (!existing) throw new NotFoundError("Template not found");

  await db
    .update(notificationTemplates)
    .set({
      titleTemplate: input.titleTemplate,
      bodyTemplate: input.bodyTemplate,
      updatedAt: new Date(),
    })
    .where(eq(notificationTemplates.id, existing.id));

  await writeAuditLog({
    actorId: actor.id,
    action: "notification_template.update",
    entityType: "notification_template",
    entityId: existing.id,
    before: {
      titleTemplate: existing.titleTemplate,
      bodyTemplate: existing.bodyTemplate,
    },
    after: input,
  });

  return { id: existing.id, slug };
}

export async function getPlatformSettings(actor: AuthUser) {
  assertAdmin(actor);
  const rows = await db.query.systemSettings.findMany();
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    defaultServiceFeeBps:
      typeof map.get(SETTINGS_KEYS.defaultServiceFeeBps) === "number"
        ? (map.get(SETTINGS_KEYS.defaultServiceFeeBps) as number)
        : DEFAULT_SERVICE_FEE_BPS,
    notificationsEnabled: map.get(SETTINGS_KEYS.notificationsEnabled) !== false,
  };
}

const platformSettingsSchema = z.object({
  defaultServiceFeeBps: z.number().int().min(0).max(10000).optional(),
  notificationsEnabled: z.boolean().optional(),
});

export async function updatePlatformSettings(actor: AuthUser, raw: unknown) {
  // Super-admin only for platform settings mutations.
  if (actor.role !== "super_admin") {
    throw new ForbiddenError("Super Admin required");
  }
  const input = parseOrThrow(platformSettingsSchema, raw);
  const before = await getPlatformSettings(actor);

  if (input.defaultServiceFeeBps !== undefined) {
    await upsertSetting(SETTINGS_KEYS.defaultServiceFeeBps, input.defaultServiceFeeBps, actor.id);
  }
  if (input.notificationsEnabled !== undefined) {
    await upsertSetting(SETTINGS_KEYS.notificationsEnabled, input.notificationsEnabled, actor.id);
  }

  const after = await getPlatformSettings(actor);
  await writeAuditLog({
    actorId: actor.id,
    action: "settings.platform_update",
    entityType: "system_settings",
    entityId: "platform",
    before,
    after,
  });
  return after;
}

async function upsertSetting(key: string, value: unknown, actorId: string) {
  const existing = await db.query.systemSettings.findFirst({
    where: eq(systemSettings.key, key),
  });
  if (existing) {
    await db
      .update(systemSettings)
      .set({ value: value as never, updatedBy: actorId, updatedAt: new Date() })
      .where(eq(systemSettings.id, existing.id));
    return;
  }
  await db.insert(systemSettings).values({
    id: newId(),
    key,
    value: value as never,
    updatedBy: actorId,
  });
}

export async function unreadCount(userId: string) {
  const rows = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return Number(rows[0]?.value ?? 0);
}
