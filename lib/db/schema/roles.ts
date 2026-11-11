import { pgTable, text, primaryKey, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { idColumn, bool, utcTimestamp } from "./_shared";

/**
 * Exactly three system roles are seeded: customer, admin, super_admin.
 * New registrations always receive customer. Only super_admin manages roles.
 */
export const roles = pgTable("roles", {
  id: idColumn(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  isSystem: bool("is_system"),
  createdAt: utcTimestamp("created_at").defaultNow().notNull(),
  updatedAt: utcTimestamp("updated_at").defaultNow().notNull(),
});

export const permissions = pgTable(
  "permissions",
  {
    id: idColumn(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    module: text("module").notNull(),
    createdAt: utcTimestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("permissions_module_idx").on(t.module)],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: text("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
    createdAt: utcTimestamp("created_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

export const roleRelations = relations(roles, ({ many }) => ({
  rolePermissions: many(rolePermissions),
  users: many(users),
}));

export const permissionRelations = relations(permissions, ({ many }) => ({
  rolePermissions: many(rolePermissions),
}));

export const rolePermissionRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, { fields: [rolePermissions.roleId], references: [roles.id] }),
  permission: one(permissions, {
    fields: [rolePermissions.permissionId],
    references: [permissions.id],
  }),
}));
