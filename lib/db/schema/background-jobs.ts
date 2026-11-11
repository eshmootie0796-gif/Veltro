import { pgTable, text, jsonb, index } from "drizzle-orm/pg-core";
import { idColumn, utcTimestamp } from "./_shared";

/**
 * Scheduled job execution records.
 * status: pending | running | succeeded | failed
 * Used for expiring capacity/discount reservations and similar tasks.
 */
export const backgroundJobs = pgTable(
  "background_jobs",
  {
    id: idColumn(),
    type: text("type").notNull(),
    status: text("status").notNull().default("pending"),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    error: text("error"),
    startedAt: utcTimestamp("started_at"),
    finishedAt: utcTimestamp("finished_at"),
    createdAt: utcTimestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("background_jobs_status_idx").on(t.status),
    index("background_jobs_type_status_idx").on(t.type, t.status),
    index("background_jobs_created_idx").on(t.createdAt),
  ],
);
