ALTER TABLE "crypto_wallet_transactions" ADD COLUMN IF NOT EXISTS "balance_before" numeric(36, 18) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "platform_fiat_treasury" (
  "id" text PRIMARY KEY NOT NULL,
  "currency_code" text DEFAULT 'IRT' NOT NULL,
  "balance_toman" bigint DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "platform_fiat_treasury_balance_nonneg_chk" CHECK (balance_toman >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "platform_fiat_treasury_currency_idx"
  ON "platform_fiat_treasury" USING btree ("currency_code");

CREATE TABLE IF NOT EXISTS "crypto_trades" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "side" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "source_currency_id" text,
  "destination_currency_id" text,
  "source_amount" numeric(36, 18) DEFAULT '0' NOT NULL,
  "destination_amount" numeric(36, 18) DEFAULT '0' NOT NULL,
  "base_toman" bigint DEFAULT 0 NOT NULL,
  "fee_toman" bigint DEFAULT 0 NOT NULL,
  "fee_bps" text DEFAULT '0' NOT NULL,
  "payable_or_payout_toman" bigint DEFAULT 0 NOT NULL,
  "pricing_snapshot" jsonb NOT NULL,
  "status" text DEFAULT 'succeeded' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "crypto_trades_side_chk" CHECK (side IN ('buy', 'sell', 'convert')),
  CONSTRAINT "crypto_trades_status_chk" CHECK (status IN ('succeeded', 'failed')),
  CONSTRAINT "crypto_trades_amounts_nonneg_chk"
    CHECK (base_toman >= 0 AND fee_toman >= 0 AND payable_or_payout_toman >= 0)
);
DO $$ BEGIN
  ALTER TABLE "crypto_trades" ADD CONSTRAINT "crypto_trades_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "crypto_trades" ADD CONSTRAINT "crypto_trades_source_currency_id_currencies_id_fk"
    FOREIGN KEY ("source_currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "crypto_trades" ADD CONSTRAINT "crypto_trades_destination_currency_id_currencies_id_fk"
    FOREIGN KEY ("destination_currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "crypto_trades_idempotency_idx"
  ON "crypto_trades" USING btree ("user_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "crypto_trades_user_idx" ON "crypto_trades" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "crypto_trades_side_idx" ON "crypto_trades" USING btree ("side");
CREATE INDEX IF NOT EXISTS "crypto_trades_created_idx" ON "crypto_trades" USING btree ("created_at");
