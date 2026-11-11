import { pgTable, text, jsonb, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { idColumn, utcTimestamp } from "./_shared";
import { users } from "./users";

/**
 * Immutable audit log for important administrative actions.
 * Append-only: never update or delete rows.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: idColumn(),
    actorId: text("actor_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: utcTimestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("audit_logs_actor_idx").on(t.actorId),
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
    index("audit_logs_created_idx").on(t.createdAt),
  ],
);

export const auditLogRelations = relations(auditLogs, ({ one }) => ({
  actor: one(users, { fields: [auditLogs.actorId], references: [users.id] }),
}));
