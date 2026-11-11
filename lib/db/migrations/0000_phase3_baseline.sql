CREATE TABLE "permissions" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"module" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permissions_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" text NOT NULL,
	"permission_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"name" text NOT NULL,
	"image" text,
	"password_hash" text,
	"role_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"email_verified" timestamp with time zone,
	"session_version" integer DEFAULT 0 NOT NULL,
	"blocked_reason" text,
	"blocked_at" timestamp with time zone,
	"blocked_by_id" text,
	"last_login_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_verification_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"session_token" text NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"icon" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "product_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"config" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_field_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"field_type" text NOT NULL,
	"options" jsonb,
	"is_required" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"validation" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"sku" text,
	"name" text NOT NULL,
	"label" text,
	"price_toman" bigint NOT NULL,
	"capacity_mode" text DEFAULT 'unlimited' NOT NULL,
	"capacity_total" integer,
	"capacity_remaining" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_variants_capacity_finite_chk" CHECK ((capacity_mode = 'unlimited' AND capacity_total IS NULL AND capacity_remaining IS NULL)
          OR (capacity_mode = 'finite' AND capacity_total IS NOT NULL AND capacity_remaining IS NOT NULL
              AND capacity_total >= 0 AND capacity_remaining >= 0 AND capacity_remaining <= capacity_total)),
	CONSTRAINT "product_variants_price_nonneg_chk" CHECK (price_toman >= 0)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"type" text DEFAULT 'product' NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"image_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "currencies" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"decimals" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "currencies_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"base_currency_id" text NOT NULL,
	"quote_currency_id" text NOT NULL,
	"rate" numeric(36, 18) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_rates_rate_positive_chk" CHECK (rate > 0)
);
--> statement-breakpoint
CREATE TABLE "crypto_reserves" (
	"id" text PRIMARY KEY NOT NULL,
	"currency_id" text NOT NULL,
	"balance" numeric(36, 18) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crypto_reserves_balance_nonneg_chk" CHECK (balance >= 0)
);
--> statement-breakpoint
CREATE TABLE "crypto_wallet_balances" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet_id" text NOT NULL,
	"currency_id" text NOT NULL,
	"balance" numeric(36, 18) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crypto_wallet_balances_nonneg_chk" CHECK (balance >= 0)
);
--> statement-breakpoint
CREATE TABLE "crypto_wallets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fiat_wallets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"balance_toman" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiat_wallets_balance_nonneg_chk" CHECK (balance_toman >= 0)
);
--> statement-breakpoint
CREATE TABLE "reserve_adjustments" (
	"id" text PRIMARY KEY NOT NULL,
	"reserve_id" text NOT NULL,
	"currency_id" text NOT NULL,
	"amount" numeric(36, 18) NOT NULL,
	"balance_after" numeric(36, 18) NOT NULL,
	"reason" text NOT NULL,
	"actor_id" text,
	"reference_type" text,
	"reference_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crypto_wallet_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet_id" text NOT NULL,
	"balance_id" text NOT NULL,
	"user_id" text,
	"currency_id" text NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(36, 18) NOT NULL,
	"balance_after" numeric(36, 18) NOT NULL,
	"reference_type" text,
	"reference_id" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fiat_wallet_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet_id" text NOT NULL,
	"user_id" text,
	"type" text NOT NULL,
	"amount_toman" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"reference_type" text,
	"reference_id" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capacity_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capacity_reservations_qty_positive_chk" CHECK (quantity > 0)
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"product_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"product_title_snap" text NOT NULL,
	"variant_name_snap" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_toman" bigint NOT NULL,
	"line_total_toman" bigint NOT NULL,
	"field_values_snap" jsonb,
	CONSTRAINT "order_items_qty_positive_chk" CHECK (quantity > 0),
	CONSTRAINT "order_items_prices_nonneg_chk" CHECK (unit_price_toman >= 0 AND line_total_toman >= 0)
);
--> statement-breakpoint
CREATE TABLE "order_status_history" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_id" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"currency_code" text DEFAULT 'IRT' NOT NULL,
	"subtotal_toman" bigint NOT NULL,
	"fee_toman" bigint DEFAULT 0 NOT NULL,
	"fixed_cost_toman" bigint DEFAULT 0 NOT NULL,
	"discount_toman" bigint DEFAULT 0 NOT NULL,
	"exchange_rate_used" numeric(36, 18),
	"exchange_base_code" text,
	"exchange_quote_code" text,
	"payable_toman" bigint NOT NULL,
	"discount_code_snapshot" text,
	"pricing_snapshot" jsonb NOT NULL,
	"customer_input_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_amounts_nonneg_chk" CHECK (subtotal_toman >= 0 AND fee_toman >= 0 AND fixed_cost_toman >= 0 AND discount_toman >= 0 AND payable_toman >= 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"user_id" text NOT NULL,
	"method" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount_toman" bigint NOT NULL,
	"crypto_currency_code" text,
	"crypto_amount" numeric(36, 18),
	"gateway_ref" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_nonneg_chk" CHECK (amount_toman >= 0)
);
--> statement-breakpoint
CREATE TABLE "discount_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"discount_id" text NOT NULL,
	"user_id" text NOT NULL,
	"order_id" text NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discount_usages" (
	"id" text PRIMARY KEY NOT NULL,
	"discount_id" text NOT NULL,
	"user_id" text NOT NULL,
	"order_id" text NOT NULL,
	"amount_toman" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_usages_amount_nonneg_chk" CHECK (amount_toman >= 0)
);
--> statement-breakpoint
CREATE TABLE "discounts" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'fixed' NOT NULL,
	"fixed_amount_toman" bigint,
	"percentage_bps" integer,
	"max_discount_toman" bigint,
	"is_active" boolean DEFAULT true NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"usage_limit" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discounts_percentage_bps_chk" CHECK (percentage_bps IS NULL OR (percentage_bps >= 0 AND percentage_bps <= 10000))
);
--> statement-breakpoint
CREATE TABLE "notification_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"channel" text DEFAULT 'in_app' NOT NULL,
	"title_template" text NOT NULL,
	"body_template" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"template_id" text,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"data" jsonb,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"product_id" text NOT NULL,
	"user_id" text NOT NULL,
	"rating" integer NOT NULL,
	"title" text,
	"body" text,
	"moderation" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_rating_chk" CHECK (rating >= 1 AND rating <= 5)
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "background_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payload" jsonb,
	"result" jsonb,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_verification_codes" ADD CONSTRAINT "email_verification_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_codes" ADD CONSTRAINT "password_reset_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_configs" ADD CONSTRAINT "product_configs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_field_definitions" ADD CONSTRAINT "product_field_definitions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_base_currency_id_currencies_id_fk" FOREIGN KEY ("base_currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_quote_currency_id_currencies_id_fk" FOREIGN KEY ("quote_currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crypto_reserves" ADD CONSTRAINT "crypto_reserves_currency_id_currencies_id_fk" FOREIGN KEY ("currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crypto_wallet_balances" ADD CONSTRAINT "crypto_wallet_balances_wallet_id_crypto_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."crypto_wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crypto_wallet_balances" ADD CONSTRAINT "crypto_wallet_balances_currency_id_currencies_id_fk" FOREIGN KEY ("currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crypto_wallets" ADD CONSTRAINT "crypto_wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiat_wallets" ADD CONSTRAINT "fiat_wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserve_adjustments" ADD CONSTRAINT "reserve_adjustments_reserve_id_crypto_reserves_id_fk" FOREIGN KEY ("reserve_id") REFERENCES "public"."crypto_reserves"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserve_adjustments" ADD CONSTRAINT "reserve_adjustments_currency_id_currencies_id_fk" FOREIGN KEY ("currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserve_adjustments" ADD CONSTRAINT "reserve_adjustments_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crypto_wallet_transactions" ADD CONSTRAINT "crypto_wallet_transactions_wallet_id_crypto_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."crypto_wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crypto_wallet_transactions" ADD CONSTRAINT "crypto_wallet_transactions_balance_id_crypto_wallet_balances_id_fk" FOREIGN KEY ("balance_id") REFERENCES "public"."crypto_wallet_balances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crypto_wallet_transactions" ADD CONSTRAINT "crypto_wallet_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crypto_wallet_transactions" ADD CONSTRAINT "crypto_wallet_transactions_currency_id_currencies_id_fk" FOREIGN KEY ("currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiat_wallet_transactions" ADD CONSTRAINT "fiat_wallet_transactions_wallet_id_fiat_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."fiat_wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiat_wallet_transactions" ADD CONSTRAINT "fiat_wallet_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capacity_reservations" ADD CONSTRAINT "capacity_reservations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capacity_reservations" ADD CONSTRAINT "capacity_reservations_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_reservations" ADD CONSTRAINT "discount_reservations_discount_id_discounts_id_fk" FOREIGN KEY ("discount_id") REFERENCES "public"."discounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_reservations" ADD CONSTRAINT "discount_reservations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_reservations" ADD CONSTRAINT "discount_reservations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_usages" ADD CONSTRAINT "discount_usages_discount_id_discounts_id_fk" FOREIGN KEY ("discount_id") REFERENCES "public"."discounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_usages" ADD CONSTRAINT "discount_usages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_usages" ADD CONSTRAINT "discount_usages_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_template_id_notification_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."notification_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "permissions_module_idx" ON "permissions" USING btree ("module");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_idx" ON "users" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_idx" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "users_deleted_at_idx" ON "users" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_idx" ON "accounts" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "email_verification_codes_user_idx" ON "email_verification_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "email_verification_codes_expires_idx" ON "email_verification_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "password_reset_codes_user_idx" ON "password_reset_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "password_reset_codes_expires_idx" ON "password_reset_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires");--> statement-breakpoint
CREATE INDEX "categories_sort_idx" ON "categories" USING btree ("sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "product_configs_product_idx" ON "product_configs" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_field_definitions_product_key_idx" ON "product_field_definitions" USING btree ("product_id","key");--> statement-breakpoint
CREATE INDEX "product_field_definitions_product_idx" ON "product_field_definitions" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_sku_idx" ON "product_variants" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "product_variants_product_idx" ON "product_variants" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_variants_active_idx" ON "product_variants" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "products_slug_idx" ON "products" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "products_type_idx" ON "products" USING btree ("type");--> statement-breakpoint
CREATE INDEX "products_active_idx" ON "products" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "currencies_kind_idx" ON "currencies" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "currencies_active_idx" ON "currencies" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_rates_pair_idx" ON "exchange_rates" USING btree ("base_currency_id","quote_currency_id");--> statement-breakpoint
CREATE INDEX "exchange_rates_active_idx" ON "exchange_rates" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "crypto_reserves_currency_idx" ON "crypto_reserves" USING btree ("currency_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crypto_wallet_balances_wallet_currency_idx" ON "crypto_wallet_balances" USING btree ("wallet_id","currency_id");--> statement-breakpoint
CREATE INDEX "crypto_wallet_balances_currency_idx" ON "crypto_wallet_balances" USING btree ("currency_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crypto_wallets_user_idx" ON "crypto_wallets" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fiat_wallets_user_idx" ON "fiat_wallets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reserve_adjustments_reserve_idx" ON "reserve_adjustments" USING btree ("reserve_id");--> statement-breakpoint
CREATE INDEX "reserve_adjustments_created_idx" ON "reserve_adjustments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "crypto_wallet_transactions_wallet_idx" ON "crypto_wallet_transactions" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX "crypto_wallet_transactions_balance_idx" ON "crypto_wallet_transactions" USING btree ("balance_id");--> statement-breakpoint
CREATE INDEX "crypto_wallet_transactions_user_idx" ON "crypto_wallet_transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "crypto_wallet_transactions_ref_idx" ON "crypto_wallet_transactions" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "crypto_wallet_transactions_created_idx" ON "crypto_wallet_transactions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "fiat_wallet_transactions_wallet_idx" ON "fiat_wallet_transactions" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX "fiat_wallet_transactions_user_idx" ON "fiat_wallet_transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "fiat_wallet_transactions_ref_idx" ON "fiat_wallet_transactions" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "fiat_wallet_transactions_created_idx" ON "fiat_wallet_transactions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "capacity_reservations_order_idx" ON "capacity_reservations" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "capacity_reservations_variant_status_idx" ON "capacity_reservations" USING btree ("variant_id","status");--> statement-breakpoint
CREATE INDEX "capacity_reservations_expires_idx" ON "capacity_reservations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_product_idx" ON "order_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "order_status_history_order_idx" ON "order_status_history" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_status_history_created_idx" ON "order_status_history" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "orders_user_idx" ON "orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_created_idx" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payments_user_idx" ON "payments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "discount_reservations_discount_status_idx" ON "discount_reservations" USING btree ("discount_id","status");--> statement-breakpoint
CREATE INDEX "discount_reservations_order_idx" ON "discount_reservations" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "discount_reservations_expires_idx" ON "discount_reservations" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "discount_usages_order_idx" ON "discount_usages" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "discount_usages_discount_idx" ON "discount_usages" USING btree ("discount_id");--> statement-breakpoint
CREATE INDEX "discount_usages_user_idx" ON "discount_usages" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discounts_code_idx" ON "discounts" USING btree ("code");--> statement-breakpoint
CREATE INDEX "discounts_active_idx" ON "discounts" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_templates_slug_idx" ON "notification_templates" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_read_idx" ON "notifications" USING btree ("read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_order_user_product_idx" ON "reviews" USING btree ("order_id","user_id","product_id");--> statement-breakpoint
CREATE INDEX "reviews_product_idx" ON "reviews" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "reviews_user_idx" ON "reviews" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "system_settings_key_idx" ON "system_settings" USING btree ("key");--> statement-breakpoint
CREATE INDEX "background_jobs_status_idx" ON "background_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "background_jobs_type_status_idx" ON "background_jobs" USING btree ("type","status");--> statement-breakpoint
CREATE INDEX "background_jobs_created_idx" ON "background_jobs" USING btree ("created_at");