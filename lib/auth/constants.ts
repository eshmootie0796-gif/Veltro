export const ROLE_SLUGS = ["customer", "admin", "super_admin"] as const;
export type RoleSlug = (typeof ROLE_SLUGS)[number];

export const USER_STATUSES = ["active", "blocked", "deleted"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Verification / reset codes expire after 30 minutes. */
export const AUTH_CODE_TTL_MS = 30 * 60 * 1000;

/** Opaque codes are 8 digits (simulated email channel). */
export const AUTH_CODE_LENGTH = 8;

export const ACCOUNT_DELETION_FORFEITURE_NOTICE =
  "Deleting your account permanently forfeits all Toman and cryptocurrency wallet balances. Orders and financial history are retained for administration. Refunds after deletion do not restore wallet balances or create payouts.";
