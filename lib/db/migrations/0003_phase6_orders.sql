ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "discount_id" text;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_expires_at" timestamp with time zone;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "last_status_note" text;
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'awaiting_payment';
CREATE INDEX IF NOT EXISTS "orders_payment_expires_idx" ON "orders" USING btree ("payment_expires_at");
DO $$ BEGIN
  ALTER TABLE "orders" ADD CONSTRAINT "orders_discount_id_discounts_id_fk"
    FOREIGN KEY ("discount_id") REFERENCES "public"."discounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "discounts" ADD COLUMN IF NOT EXISTS "per_user_limit" integer;
ALTER TABLE "discounts" ADD COLUMN IF NOT EXISTS "min_order_amount_toman" bigint;
ALTER TABLE "discounts" ADD COLUMN IF NOT EXISTS "scope_type" text DEFAULT 'all' NOT NULL;
ALTER TABLE "discounts" ADD COLUMN IF NOT EXISTS "scope_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
DO $$ BEGIN
  ALTER TABLE "discounts" ADD CONSTRAINT "discounts_scope_type_chk" CHECK (scope_type IN ('all', 'category', 'product'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "discount_reservations_order_unique_idx" ON "discount_reservations" USING btree ("order_id");
