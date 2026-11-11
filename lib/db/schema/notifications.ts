import { pgTable, text, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { idColumn, utcTimestamp } from "./_shared";
import { users } from "./users";

/**
 * Templates for in-app (and simulated email) notifications.
 * channel: in_app | email_sim
 */
export const notificationTemplates = pgTable(
  "notification_templates",
  {
    id: idColumn(),
    slug: text("slug").notNull(),
    channel: text("channel").notNull().default("in_app"),
    titleTemplate: text("title_template").notNull(),
    bodyTemplate: text("body_template").notNull(),
    createdAt: utcTimestamp("created_at").defaultNow().notNull(),
    updatedAt: utcTimestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("notification_templates_slug_idx").on(t.slug)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: idColumn(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    templateId: text("template_id").references(() => notificationTemplates.id),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    data: jsonb("data").$type<Record<string, unknown>>(),
    readAt: utcTimestamp("read_at"),
    createdAt: utcTimestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("notifications_user_idx").on(t.userId),
    index("notifications_user_created_idx").on(t.userId, t.createdAt),
    index("notifications_read_idx").on(t.readAt),
  ],
);

export const notificationTemplateRelations = relations(notificationTemplates, ({ many }) => ({
  notifications: many(notifications),
}));

export const notificationRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
  template: one(notificationTemplates, {
    fields: [notifications.templateId],
    references: [notificationTemplates.id],
  }),
}));
