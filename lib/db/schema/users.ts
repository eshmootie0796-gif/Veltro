import { pgTable, text, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { roles } from "./roles";
import { idColumn, utcTimestamp } from "./_shared";

/**
 * Platform users. Soft-delete only (status=deleted + deletedAt).
 * status: active | blocked | deleted
 * sessionVersion increments on block/delete to invalidate all JWTs.
 */
export const users = pgTable(
  "users",
  {
    id: idColumn(),
    username: text("username").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    /** Display name kept for Auth.js compatibility. */
    name: text("name").notNull(),
    image: text("image"),
    passwordHash: text("password_hash"),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id),
    status: text("status").notNull().default("active"),
    emailVerified: utcTimestamp("email_verified"),
    sessionVersion: integer("session_version").notNull().default(0),
    blockedReason: text("blocked_reason"),
    blockedAt: utcTimestamp("blocked_at"),
    blockedById: text("blocked_by_id"),
    lastLoginAt: utcTimestamp("last_login_at"),
    deletedAt: utcTimestamp("deleted_at"),
    createdAt: utcTimestamp("created_at").defaultNow().notNull(),
    updatedAt: utcTimestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("users_username_idx").on(t.username),
    uniqueIndex("users_email_idx").on(t.email),
    uniqueIndex("users_phone_idx").on(t.phone),
    index("users_role_idx").on(t.roleId),
    index("users_status_idx").on(t.status),
    index("users_deleted_at_idx").on(t.deletedAt),
  ],
);

export const userRelations = relations(users, ({ one }) => ({
  role: one(roles, { fields: [users.roleId], references: [roles.id] }),
  blockedBy: one(users, {
    fields: [users.blockedById],
    references: [users.id],
    relationName: "user_blocked_by",
  }),
}));
