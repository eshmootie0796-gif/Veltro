# Phase 11 — API Completion, Testing, Deployment

Backend-only. No frontend. No support-ticket endpoints.

## 1. API endpoint inventory (paths only)

### Auth / account
- `/api/auth/[...nextauth]`
- `/api/auth/register`
- `/api/auth/verify-email/request`
- `/api/auth/verify-email/confirm`
- `/api/auth/password-reset/request`
- `/api/auth/password-reset/confirm`
- `/api/auth/password-change/request-code`
- `/api/auth/password-change`
- `/api/auth/me`
- `/api/account/delete`

### Catalog (public)
- `/api/catalog/categories`
- `/api/catalog/products`
- `/api/catalog/products/[slug]`
- `/api/catalog/products/[slug]/validate-fields`
- `/api/catalog/products/[slug]/reviews`

### Pricing
- `/api/pricing/availability`
- `/api/pricing/quote/fx`
- `/api/pricing/quote/crypto`

### Orders / payments / wallet (customer)
- `/api/orders`
- `/api/orders/[id]`
- `/api/orders/[id]/cancel`
- `/api/orders/[id]/request-cancellation`
- `/api/orders/[id]/pay`
- `/api/orders/[id]/payments`
- `/api/wallet`
- `/api/wallet/topup`
- `/api/wallet/transactions`

### Crypto (customer)
- `/api/crypto/wallet`
- `/api/crypto/quote`
- `/api/crypto/buy`
- `/api/crypto/sell`
- `/api/crypto/convert`
- `/api/crypto/trades`
- `/api/crypto/transactions`

### Notifications / reviews
- `/api/notifications`
- `/api/notifications/read-all`
- `/api/notifications/[id]/read`
- `/api/reviews`

### Admin
- `/api/admin/catalog/categories`
- `/api/admin/catalog/products`
- `/api/admin/catalog/products/[id]`
- `/api/admin/catalog/products/[id]/activate`
- `/api/admin/catalog/products/[id]/deactivate`
- `/api/admin/catalog/products/[id]/fields`
- `/api/admin/catalog/products/[id]/variants`
- `/api/admin/catalog/products/[id]/pricing`
- `/api/admin/catalog/variants/[id]`
- `/api/admin/pricing/rates`
- `/api/admin/pricing/refresh`
- `/api/admin/discounts`
- `/api/admin/orders`
- `/api/admin/orders/[id]`
- `/api/admin/orders/[id]/status`
- `/api/admin/orders/[id]/reject-cancellation`
- `/api/admin/payments`
- `/api/admin/wallet-transactions`
- `/api/admin/customers`
- `/api/admin/customers/[id]`
- `/api/admin/users/[id]/block`
- `/api/admin/users/[id]/unblock`
- `/api/admin/users/[id]/role`
- `/api/admin/admins`
- `/api/admin/reviews`
- `/api/admin/reviews/[id]/moderate`
- `/api/admin/reports`
- `/api/admin/audit-logs`
- `/api/admin/settings/platform`
- `/api/admin/settings/wallet-topup`
- `/api/admin/settings/crypto-trade-fee`
- `/api/admin/notification-templates`
- `/api/admin/notification-templates/[slug]`
- `/api/admin/crypto/reserves`
- `/api/admin/crypto/reserves/increase`

### Cron (secret-authenticated)
- `/api/cron/maintenance`
- `/api/cron/expire-orders`
- `/api/cron/refresh-rates`

Response envelope: `{ success: true, data, meta? }` or `{ success: false, error: { code, message, details? } }`.

## 2. Database schema overview

| Area | Tables |
| --- | --- |
| Auth / users | `users`, `accounts`, `sessions`, `verification_tokens`, `roles` |
| Catalog | `categories`, `products`, `product_configs`, `product_variants`, `product_field_definitions` |
| Pricing | `currencies`, `exchange_rates` (legacy), `rate_feeds`, `rate_feed_snapshots`, `provider_statuses` |
| Orders | `orders`, `order_items`, `order_status_history`, `capacity_reservations` |
| Discounts | `discounts`, `discount_reservations`, `discount_usages` |
| Payments / wallets | `payments`, `fiat_wallets`, `fiat_wallet_transactions`, `crypto_wallets`, `crypto_wallet_balances`, `crypto_wallet_transactions` |
| Crypto trading | `crypto_reserves`, `reserve_adjustments`, `crypto_trades`, `platform_fiat_treasury` |
| Comms / quality | `notifications`, `notification_templates`, `reviews` |
| Admin / ops | `audit_logs`, `system_settings`, `background_jobs` |

Money: Toman = integer `bigint`; crypto/FX = `numeric(36,18)`. Soft-delete on catalog. Audit / notifications / usages / ledger append-oriented.

Migrations: `lib/db/migrations/0000` … `0005_phase8_crypto_trading.sql`.

## 3. Environment variables

See `.env.example`. Never use `NEXT_PUBLIC_*` for secrets.

| Key | Required prod | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Neon Postgres |
| `AUTH_SECRET` | yes | Auth.js JWT (≥16 chars) |
| `APP_URL` | yes | Absolute app URL / OAuth callbacks |
| `CRON_SECRET` | yes | Cron Bearer / `x-cron-secret` |
| `AUTH_TRUST_HOST` | recommended | `true` on Vercel |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | optional | Google OAuth |
| `R2_*` | optional | Cloudflare R2 uploads |
| `EXCHANGE_RATE_API_URL` / `_KEY` | for FX | Single FX provider |
| `CRYPTO_PRICE_API_URL` / `_KEY` | for crypto | Single crypto provider |
| `RATE_MAX_AGE_MS` | optional | Default 15m |
| `ADMIN_BOOTSTRAP_*` | seed only | First Super Admin |
| `DB_POOL_MAX` | optional | Neon pool (Vercel → 1) |

Validate: `npm run env:validate`.

## 4. Migration instructions

```bash
# Local / CI with .env
npm run db:migrate:run
npm run db:verify
npm run db:seed
```

Generate after schema edits: `npm run db:generate` then review SQL under `lib/db/migrations/`.

Neon: use pooled URL for runtime; if migrate fails through pooler, use direct (non-pooler) URL for migrate only.

## 5. Deployment instructions (Vercel + Neon + R2)

1. Create Neon project; copy connection string → `DATABASE_URL`.
2. Vercel project → import repo → Framework: Next.js.
3. Set env vars from §3 (Production + Preview as needed). **Do not** expose private keys as `NEXT_PUBLIC_*`.
4. Run migrations against Neon (`db:migrate:run` from CI or one-off machine).
5. Seed once: `npm run db:seed`.
6. Google Cloud Console: OAuth redirect `{APP_URL}/api/auth/callback/google`.
7. R2: create bucket + API token; set `R2_*`; public URL if serving assets.
8. Deploy. Confirm `npm run typecheck` and `npm run build` locally first.
9. Cron: see §6 (Pro required for 5-minute Vercel Cron).

Build scripts: `npm run build`, `npm start`, `npm run typecheck`, `npm run test:all`, `npm run env:validate`.

## 6. Cron configuration

### Target behavior (idempotent)
`/api/cron/maintenance` every **5 minutes**:
1. Expire unpaid orders (`FOR UPDATE SKIP LOCKED`)
2. Release expired capacity + discount reservations
3. Refresh FX + crypto providers; mark unhealthy on failure (no stale-rate reuse)

Auth header only: `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret: <CRON_SECRET>`. Query-string secrets removed (log leakage).

### Vercel plan reality
| Plan | Native Cron | `*/5 * * * *` |
| --- | --- | --- |
| **Hobby** | **Once per day max** | **Rejected at deploy** |
| **Pro / Enterprise** | Every minute | Supported |

`vercel.json` ships Pro schedule:

```json
{ "crons": [{ "path": "/api/cron/maintenance", "schedule": "*/5 * * * *" }] }
```

Vercel Cron invokes **GET** on production only. Route also accepts POST for external schedulers.

### Hobby / no-Pro compatible approach
Do **not** put `*/5` in `vercel.json` on Hobby (deploy fails). Options:
1. **Upgrade to Pro** (recommended for payment TTL of 15 minutes).
2. **External scheduler** (cron-job.org, GitHub Actions `*/5`, Cloudflare Cron Triggers) → `GET/POST https://<host>/api/cron/maintenance` with Bearer secret.
3. Hobby-only native: daily cron is too coarse for 15-minute payment windows — unpaid orders would linger; use external 5-minute caller.

Manual: `npm run jobs:run`.

## 7. Security review report

Source: [Security Review](570f99e3-e3ca-4af4-82ae-573aa5389391) + Phase 11 hardening.

### Solid
- Role gates + ownership on customer money paths
- Argon2id; `sessionVersion` JWT invalidation
- Zod + parameterized Drizzle; SSRF baseline on shopping extract
- Cron header-only + constant-time secret compare
- Capacity/discount/wallet races use locks; last Super Admin protected

### Fixed in Phase 11 follow-up
| Was | Fix |
| --- | --- |
| Auth codes in API (takeover) | Gated by `ALLOW_SIMULATED_AUTH_CODES` / non-prod default |
| Client `simulate: success` mint | `assertMockPaymentsAllowed` / `ALLOW_MOCK_PAYMENTS` |
| Double-refund race (credit then CAS) | Lock payment → claim `refunded` → then credit; conflict throws |
| Crypto order cancel no clawback | `reverseCryptoFulfillmentIfNeeded` on cancel/reject |
| Convert mint unbound by reserve | `creditCryptoReserve(src)` + `debitCryptoReserve(dst)` |
| Google dangerous linking | `allowDangerousEmailAccountLinking: false`; no link if email unverified |
| Admin free-form `paid` status | Removed from admin status schema |
| Cron `?secret=` | Header-only |
| Account delete without step-up | Requires `currentPassword` |

### Residual
| Severity | Issue |
| --- | --- |
| Medium | SSRF TOCTOU / IPv4-mapped IPv6 on shopping fetch |
| Medium | JWT DB hit every request (cost) |
| Low | No partial unique on one succeeded order payment |
| Info | No rate limiting (v1 non-goal); Hobby cron limits (§6) |

## 8. Test report

| Script | Coverage |
| --- | --- |
| `test:auth` | Register, verify, reset, change password, block/unblock, roles, last Super Admin, delete/forfeit |
| `test:catalog` | Categories/products/variants/fields |
| `test:pricing` | Quotes, unavailable providers |
| `test:orders` | Create, capacity, expire, discount, cancel flows |
| `test:payments` | Mock pay success/fail, wallet pay, top-up, refunds |
| `test:crypto` | Buy/sell/convert, reserve rules |
| `test:categories` | Category-specific pricing resolve |
| `test:admin` | RBAC, audit, settings, notifications, reviews, reports |
| `test:concurrent` | Capacity, discount usage, wallet spend, crypto reserve races |

Run: `npm run test:all`. Typecheck: `npm run typecheck`.

## 9. Known limitations

- Simulated money / mock gateways only — no live PSP
- No support tickets
- No rate limiting
- No branding / site-settings beyond fee + notification templates
- Admins cannot change wallet balances by design
- Vercel Hobby cannot host 5-minute crons natively
- R2 optional until uploads needed
- Google OAuth account linking is permissive (`allowDangerousEmailAccountLinking`)
- Single FX + single crypto provider; failure → unavailable (no multi-provider fallback)

## 10. Recommended remaining work (order)

1. Production secrets + Neon migrate/seed + Pro cron or external 5-minute caller
2. Disable or harden Google email linking; add Auth.js `AUTH_URL` parity with `APP_URL` in Vercel
3. Replace mock payment with real gateway behind same idempotent payment service
4. Edge/WAF rate limits + bot protection (Turnstile) before public traffic
5. Observability (structured log sink, cron failure alerts)
6. Frontend / admin UI (out of scope for this backend track)
7. Support tickets only if product requires (explicitly deferred)
