import { AppError } from "../errors";
import type { CategorySlug } from "../catalog/constants";
import {
  CRYPTO_DEPENDENT_CATEGORIES,
  FX_DEPENDENT_CATEGORIES,
  PROVIDER_KEYS,
} from "./constants";
import { getProviderHealth } from "./rate-store";

export function categoryNeedsFx(categorySlug: string): boolean {
  return (FX_DEPENDENT_CATEGORIES as readonly string[]).includes(categorySlug);
}

export function categoryNeedsCrypto(categorySlug: string): boolean {
  return (CRYPTO_DEPENDENT_CATEGORIES as readonly string[]).includes(categorySlug);
}

/**
 * Gate order creation when required market APIs are unhealthy.
 * Does not fall back to last saved rates.
 */
export async function assertOrderPricingAvailable(categorySlug: CategorySlug | string) {
  if (categoryNeedsFx(categorySlug)) {
    const fx = await getProviderHealth(PROVIDER_KEYS.exchangeRate);
    if (!fx?.isHealthy) {
      throw new AppError(
        "FX_UNAVAILABLE",
        "Order creation disabled: foreign exchange rates unavailable",
        503,
      );
    }
  }

  if (categoryNeedsCrypto(categorySlug)) {
    const crypto = await getProviderHealth(PROVIDER_KEYS.cryptoPrice);
    if (!crypto?.isHealthy) {
      throw new AppError(
        "CRYPTO_UNAVAILABLE",
        "Order creation disabled: cryptocurrency market prices unavailable",
        503,
      );
    }
  }
}

export async function getPricingAvailability() {
  const fx = await getProviderHealth(PROVIDER_KEYS.exchangeRate);
  const crypto = await getProviderHealth(PROVIDER_KEYS.cryptoPrice);
  return {
    exchangeRate: {
      healthy: Boolean(fx?.isHealthy),
      lastSuccessAt: fx?.lastSuccessAt ?? null,
      lastFailureAt: fx?.lastFailureAt ?? null,
      lastError: fx?.lastError ?? null,
    },
    cryptoPrice: {
      healthy: Boolean(crypto?.isHealthy),
      lastSuccessAt: crypto?.lastSuccessAt ?? null,
      lastFailureAt: crypto?.lastFailureAt ?? null,
      lastError: crypto?.lastError ?? null,
    },
    orderCreationBlockedCategories: {
      fxDependent: fx?.isHealthy ? [] : [...FX_DEPENDENT_CATEGORIES],
      cryptoDependent: crypto?.isHealthy ? [] : [...CRYPTO_DEPENDENT_CATEGORIES],
    },
  };
}
