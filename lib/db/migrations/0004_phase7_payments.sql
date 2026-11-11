ALTER TABLE "fiat_wallet_transactions" ADD COLUMN IF NOT EXISTS "balance_before" bigint NOT NULL DEFAULT 0;

ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "purpose" text NOT NULL DEFAULT 'order';
ALTER TABLE "payments" ALTER COLUMN "order_id" DROP NOT NULL;
CREATE INDEX IF NOT EXISTS "payments_purpose_idx" ON "payments" USING btree ("purpose");
DO $$ BEGIN
  ALTER TABLE "payments" ADD CONSTRAINT "payments_purpose_chk" CHECK (purpose IN ('order', 'topup'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "payments" ADD CONSTRAINT "payments_order_purpose_chk"
    CHECK ((purpose = 'order' AND order_id IS NOT NULL) OR (purpose = 'topup' AND order_id IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
