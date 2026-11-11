import { randomUUID } from "crypto";

/**
 * Shared id generator for all primary keys. UUIDs are generated in
 * application code so no extension/trigger is required at the database level.
 */
export const newId = (): string => randomUUID();
