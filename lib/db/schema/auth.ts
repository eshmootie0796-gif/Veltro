import { pgTable, text, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { idColumn, utcTimestamp } from "./_shared";

/**
 * Auth.js account links (credentials now; OAuth-ready later).
 * Multiple simultaneous sessions are allowed.
 */
export const accounts = pgTable(
  "accounts",
  {
    id: idColumn(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refreshToken: text("refresh_token"),
    accessToken: text("access_token"),
    expiresAt: integer("expires_at"),
    tokenType: text("token_type"),
    scope: text("scope"),
    idToken: text("id_token"),
    sessionState: text("session_state"),
    createdAt: utcTimestamp("created_at").defaultNow().notNull(),
    updatedAt: utcTimestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("accounts_provider_idx").on(t.provider, t.providerAccountId),
    index("accounts_user_idx").on(t.userId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: idColumn(),
    sessionToken: text("session_token").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires: utcTimestamp("expires").notNull(),
    createdAt: utcTimestamp("created_at").defaultNow().notNull(),
    updatedAt: utcTimestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("sessions_user_idx").on(t.userId),
    index("sessions_expires_idx").on(t.expires),
  ],
);

/**
 * Simulated email verification. No real email delivery in v1.
 * Store a hash of the code, never the raw code at rest when practical.
 */
export const emailVerificationCodes = pgTable(
  "email_verification_codes",
  {
    id: idColumn(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    expiresAt: utcTimestamp("expires_at").notNull(),
    consumedAt: utcTimestamp("consumed_at"),
    createdAt: utcTimestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("email_verification_codes_user_idx").on(t.userId),
    index("email_verification_codes_expires_idx").on(t.expiresAt),
  ],
);

/**
 * Simulated password reset. No real email delivery in v1.
 */
export const passwordResetCodes = pgTable(
  "password_reset_codes",
  {
    id: idColumn(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    expiresAt: utcTimestamp("expires_at").notNull(),
    consumedAt: utcTimestamp("consumed_at"),
    createdAt: utcTimestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("password_reset_codes_user_idx").on(t.userId),
    index("password_reset_codes_expires_idx").on(t.expiresAt),
  ],
);

export const accountRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const sessionRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const emailVerificationCodeRelations = relations(emailVerificationCodes, ({ one }) => ({
  user: one(users, { fields: [emailVerificationCodes.userId], references: [users.id] }),
}));

export const passwordResetCodeRelations = relations(passwordResetCodes, ({ one }) => ({
  user: one(users, { fields: [passwordResetCodes.userId], references: [users.id] }),
}));
