import { env } from "../../env";
import { AppError } from "../../errors";
import type { FetchedRate, RateProvider } from "./types";

/**
 * Single configured crypto market API adapter.
 * Expected JSON:
 * { provider?: string, prices: [{ symbol, quote?, price, marketTimestamp? }] }
 * Rates are quote units per 1 unit of crypto (e.g. USDT per BTC, or IRT per USDT).
 */
export function createCryptoProvider(): RateProvider {
  return {
    key: "crypto_price",
    name: "configured_crypto_api",
    async fetchRates(bases, quoteCode) {
      const url = env.CRYPTO_PRICE_API_URL;
      if (!url) {
        throw new AppError(
          "CRYPTO_PROVIDER_UNCONFIGURED",
          "Cryptocurrency price API is not configured",
          503,
        );
      }

      const endpoint = new URL(url);
      endpoint.searchParams.set("symbols", bases.join(","));
      endpoint.searchParams.set("quote", quoteCode);

      const headers: Record<string, string> = { Accept: "application/json" };
      if (env.CRYPTO_PRICE_API_KEY) {
        headers.Authorization = `Bearer ${env.CRYPTO_PRICE_API_KEY}`;
      }

      const response = await fetch(endpoint, { headers, cache: "no-store" });
      if (!response.ok) {
        throw new AppError("CRYPTO_PROVIDER_HTTP", `Crypto API HTTP ${response.status}`, 503);
      }

      const body = (await response.json()) as Record<string, unknown>;
      return normalizeCryptoPayload(body, bases, quoteCode, "configured_crypto_api");
    },
  };
}

export function normalizeCryptoPayload(
  body: Record<string, unknown>,
  bases: string[],
  quoteCode: string,
  providerName: string,
): FetchedRate[] {
  const rows = Array.isArray(body.prices) ? body.prices : Array.isArray(body.rates) ? body.rates : null;
  if (!rows) {
    throw new AppError("CRYPTO_PROVIDER_INVALID", "Crypto API returned invalid payload", 503);
  }

  const wanted = new Set(bases.map((b) => b.toUpperCase()));
  const out: FetchedRate[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const base = String(r.symbol ?? r.base ?? r.baseCode ?? "").toUpperCase();
    const quote = String(r.quote ?? r.quoteCode ?? quoteCode).toUpperCase();
    const rate = String(r.price ?? r.rate ?? "");
    if (!wanted.has(base) || !rate || Number(rate) <= 0) continue;
    const marketRaw = r.marketTimestamp ?? r.timestamp;
    out.push({
      baseCode: base,
      quoteCode: quote,
      rate,
      marketTimestamp:
        marketRaw === null || marketRaw === undefined || marketRaw === ""
          ? null
          : new Date(marketRaw as string | number),
      providerName: String(body.provider ?? providerName),
    });
  }

  return out;
}
