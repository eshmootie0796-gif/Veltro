import { CATEGORY_SLUGS, type CategorySlug } from "../catalog/constants";

export const PROVIDER_KEYS = {
  exchangeRate: "exchange_rate",
  cryptoPrice: "crypto_price",
} as const;

export type ProviderKey = (typeof PROVIDER_KEYS)[keyof typeof PROVIDER_KEYS];

export const RATE_VALIDATION = {
  valid: "valid",
  invalid: "invalid",
  stale: "stale",
  unavailable: "unavailable",
} as const;

export type RateValidationStatus = (typeof RATE_VALIDATION)[keyof typeof RATE_VALIDATION];

/** Default max age for a valid feed before it is treated as unusable. */
export const DEFAULT_RATE_MAX_AGE_MS = 15 * 60 * 1000;

/** Cron check interval (documented default). */
export const DEFAULT_RATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/** Quote snapshot validity window for payment. */
export const PRICING_QUOTE_TTL_MS = 15 * 60 * 1000;

/** Categories that require a healthy FX feed for order creation. */
export const FX_DEPENDENT_CATEGORIES: readonly CategorySlug[] = [
  CATEGORY_SLUGS.visaMastercard,
  CATEGORY_SLUGS.giftCardsPremium,
  CATEGORY_SLUGS.paypalServices,
  CATEGORY_SLUGS.internationalShopping,
  CATEGORY_SLUGS.inAppGamePurchases,
  CATEGORY_SLUGS.cryptocurrency,
];

/** Categories that additionally require a healthy crypto market feed. */
export const CRYPTO_DEPENDENT_CATEGORIES: readonly CategorySlug[] = [
  CATEGORY_SLUGS.cryptocurrency,
];

export const QUOTE_CURRENCY = "IRT";
