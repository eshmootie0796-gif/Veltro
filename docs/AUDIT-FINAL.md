# Final Backend Architecture & Business Logic Audit

Independent review. Prior Phase 11 work not trusted by existence alone.
Fixes applied only for Critical/High where safe (no destructive migrations).

Auditors: parent pass + [Finance Audit](6e5cbe91-ca93-4ab6-a8a8-f2d87bcfb167) + [Auth/API Audit](f3bf9757-d827-4a18-9246-7d6bc99fd489).

---

## Critical

| Issue | Evidence | Status |
| --- | --- | --- |
| Admin could set `awaiting_payment` → `completed` / `processing` (free fulfillment) | `adminUpdateOrderStatus` lacked transition matrix | **Fixed:** `ADMIN_ALLOWED_TRANSITIONS` in `lib/orders/constants.ts` + gate in lifecycle |
| Auth codes / mock pay in production | Prior P11 gates | **Fixed earlier:** `ALLOW_SIMULATED_AUTH_CODES` / `ALLOW_MOCK_PAYMENTS` |
| Double-refund race | Credit before CAS | **Fixed earlier:** claim `refunded` then credit |
| Convert unbound by reserve | User↔user only | **Fixed earlier:** credit src / debit dst reserve |
| Crypto cancel no clawback | Paid crypto_reserve cancel | **Fixed earlier**; spent coins no longer block fiat refund |
| Client FX underpay (gift/game) + dust→0 Toman + shopping `price<=0` | [Finance Audit](6e5cbe91-ca93-4ab6-a8a8-f2d87bcfb167) | **Fixed:** gift denom-bound; game fixed-only; FX/`quoteCryptoPrice` require amount>0 & final≥1 Toman; shopping rejects ≤0 |

---

## High

| Issue | Evidence | Status |
| --- | --- | --- |
| SSRF IPv4-mapped IPv6 (`::ffff:127.0.0.1`) | `isPrivateIpv6` missed mapped form | **Fixed:** `lib/services/shopping/ssrf.ts` |
| `createOrder` skipped `assertVerifiedCustomer` | Service callable without API gate | **Fixed:** assert at service entry |
| Google soft-link / unused `accounts` | Email match into privilege or password users | **Fixed:** provider bind + customer-only; no password soft-link ([Auth/API Audit](f3bf9757-d827-4a18-9246-7d6bc99fd489)) |
| Admin free-form `paid` | Bypass payment | **Fixed earlier** (removed from schema) |
| Crypto clawback if user spent coins | Cancel threw mid-tx | **Fixed:** soft skip clawback; fiat refund still completes |
| `getOrderAdmin` route-only RBAC | Service reusable without assert | **Fixed:** `assertAdmin(actor)` |
| Peer-admin block | Admin could block admin | **Fixed:** super_admin only |
| Role change no `sessionVersion` bump | Stale JWT role until reload | **Fixed:** bump on assign |
| IDOR 403 oracle | Wrong owner → Forbidden | **Fixed:** NotFound |
| Auth enum via reset/verify shape | `alreadyVerified` / asymmetric expires | **Fixed:** uniform responses |

---

## Medium

| Issue | Notes |
| --- | --- |
| No partial unique index on one `succeeded` order payment | App checks + tx rollback; DB backstop recommended (needs migration approval) ([Finance Audit](6e5cbe91-ca93-4ab6-a8a8-f2d87bcfb167) H4) |
| Trade quote outside TX | **Fixed:** buy/sell/convert re-quote after locks |
| Delete burns crypto off reserve | **Fixed:** forfeiture credits `creditCryptoReserve` |
| SSRF DNS TOCTOU / rebinding | Resolve then `fetch(hostname)` still races; pin-to-IP hard on undici ([Auth/API Audit](f3bf9757-d827-4a18-9246-7d6bc99fd489)) |
| Admin ≈ platform cashier | Cancel/refund + reserve increase by design for `admin`; tighten later if needed |
| Auth codes only via API (no mailer) | Prod must keep `ALLOW_SIMULATED_AUTH_CODES` off |
| Google-only users cannot self-delete | Need password step-up or alternate OAuth confirm |
| Discount `reserved` rows count toward limit until expire job | Availability DoS on hot codes if expire lag |
| `assertManualWalletMutationForbidden` only in tests | No admin wallet-edit API exists; stub unused at runtime |
| JWT callback DB hit every request | Cost / latency, not authz hole |
| Account delete requires password | OAuth-only users blocked until password set |
| Public `/api/crypto/quote` unauthenticated | Info scrape surface |
| `checkRateProviders` nests job records inside `refreshMarketRates` | Noisy `background_jobs`; idempotent but redundant |

---

## Low

| Issue | Notes |
| --- | --- |
| Duplicated audit insert patterns (`writeAuditLog` vs raw `insert(auditLogs)`) | Consistency only |
| `jobs:run` / maintenance vs split cron paths | Prefer single `/api/cron/maintenance` |
| Endpoint inventory only in `docs/PHASE11.md` | No OpenAPI |
| Exhaustive switches sparse outside enums | Team rule present; not universal |

---

## Missing features (by design / deferred)

- Live payment gateway
- Rate limiting
- Support tickets
- Email/SMS delivery (codes simulated)
- Branding settings
- OpenAPI / generated clients
- Partial unique payment constraint migration

---

## Incorrect business rules (caught)

1. Unpaid → completed allowed — **fixed**.
2. Convert treated as pure wallet swap without reserve — **fixed**.
3. Mock success as client knob without prod gate — **fixed**.
4. Client-supplied FX for gift/game underpay — **fixed** (denom-bound / fixed catalog).
5. Shopping/FX dust priced at 0 Toman — **fixed** (reject ≤0; floor final ≥1).
6. Trade quote taken outside lock window — **fixed** (re-quote in TX).
7. Account delete burned crypto off platform reserve — **fixed** (credit reserve).

---

## Database

| Check | Result |
| --- | --- |
| Fiat/crypto non-negative CHECKs | Present on wallets/reserves |
| Toman integer / crypto numeric(36,18) | Schema `_shared` |
| Ledger append-only (no update/delete APIs) | OK |
| Soft-delete users; wallets survive | OK |
| Migrations 0000–0005 | Present; no destructive change this audit |
| Payment succeeded uniqueness | **Missing DB constraint** (medium) |

---

## Security

| Check | Result |
| --- | --- |
| Customer ownership on orders/pay/wallet/crypto/notifications/reviews | OK |
| Admin vs Super Admin (roles, audit, platform settings) | OK |
| Last Super Admin demotion | OK |
| Blocked → sessionVersion + login deny | OK |
| Cron header-only secret | OK |
| SSRF baseline + mapped IPv6 | Improved |
| Secrets not in `NEXT_PUBLIC_*` | OK |

---

## Deployment

| Check | Result |
| --- | --- |
| Hobby cannot run `*/5` Vercel Cron | Documented PHASE11 §6 — Pro or external scheduler |
| `env:validate` for prod keys | Present |
| Neon pool max 1 on Vercel | `lib/db/index.ts` |

---

## Verified OK (spot checks)

- Wallet ledger: lock → non-neg → append row
- Wallet pay: single tx; insufficient funds leaves order alive
- Capacity: `FOR UPDATE` + remaining decrement; concurrent suite
- Discount: lock + usageLimit; concurrent suite
- Expire job: `SKIP LOCKED` + release holds
- Pricing snapshot stored on order; payable from snapshot path
- 15m TTL = `ORDER_PAYMENT_TTL_MS`
- Refund claim-before-credit
- Crypto buy/sell reserve + treasury locks

---

## Fixes applied this audit

1. `ADMIN_ALLOWED_TRANSITIONS` + lifecycle enforcement  
2. SSRF IPv4-mapped IPv6 private detection  
3. `assertVerifiedCustomer` in `createOrder`  
4. Soft crypto clawback on cancel (spent coins skip; fiat refund proceeds)  
5. Auth/API: Google bind, IDOR→404, peer-admin block, role→`sessionVersion`  
6. Finance: gift denom FX, game fixed-only, shopping/FX floors, in-TX trade re-quote, delete→reserve credit  
7. Regression coverage in order/auth suites  

**Not applied (need approval):** migration for unique succeeded payment per order; SSRF pin-to-IP fetch redesign.

## Test evidence (post finance fixes)

`tsc --noEmit` 0 · `test:categories` 0 · `test:crypto` 0 · `test:auth` 0 · `test:pricing` 0 · `test:orders` 0
