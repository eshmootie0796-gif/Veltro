CREATE TABLE "rate_feeds" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_key" text NOT NULL,
	"provider_name" text NOT NULL,
	"base_code" text NOT NULL,
	"quote_code" text DEFAULT 'IRT' NOT NULL,
	"rate" numeric(36, 18) DEFAULT '0' NOT NULL,
	"retrieved_at" timestamp with time zone,
	"market_timestamp" timestamp with time zone,
	"validation_status" text DEFAULT 'unavailable' NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_feeds_status_chk" CHECK (validation_status IN ('valid', 'invalid', 'stale', 'unavailable'))
);
CREATE UNIQUE INDEX "rate_feeds_provider_pair_idx" ON "rate_feeds" USING btree ("provider_key","base_code","quote_code");
CREATE INDEX "rate_feeds_status_idx" ON "rate_feeds" USING btree ("validation_status");

CREATE TABLE "rate_feed_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_key" text NOT NULL,
	"provider_name" text NOT NULL,
	"base_code" text NOT NULL,
	"quote_code" text NOT NULL,
	"rate" numeric(36, 18) DEFAULT '0' NOT NULL,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"market_timestamp" timestamp with time zone,
	"validation_status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "rate_feed_snapshots_provider_idx" ON "rate_feed_snapshots" USING btree ("provider_key","created_at");
CREATE INDEX "rate_feed_snapshots_pair_idx" ON "rate_feed_snapshots" USING btree ("base_code","quote_code");

CREATE TABLE "provider_statuses" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_key" text NOT NULL,
	"provider_name" text NOT NULL,
	"is_healthy" boolean DEFAULT false NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_statuses_provider_key_unique" UNIQUE("provider_key")
);
CREATE INDEX "provider_statuses_healthy_idx" ON "provider_statuses" USING btree ("is_healthy");
