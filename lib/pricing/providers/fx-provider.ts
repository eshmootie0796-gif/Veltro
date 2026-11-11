import { env } from "../../env";
import { AppError } from "../../errors";
import type { FetchedRate, RateProvider } from "./types";

/**
 * Single configured FX API adapter.
 * Expected JSON shape (flexible):
 * { provider?: string, rates: [{ base, quote?, rate, marketTimestamp? }] }
 * or { base: "USD", rates: { EUR: 0.92, ... } } with quote inferred as request quote.
 */
export function createFxProvider(): RateProvider {
  return {
    key: "exchange_rate",
    name: "configured_fx_api",
    async fetchRates(bases, quoteCode) {
      const url = env.EXCHANGE_RATE_API_URL;
      if (!url) {
        throw new AppError("FX_PROVIDER_UNCONFIGURED", "Exchange rate API is not configured", 503);
      }

      const endpoint = new URL(url);
      endpoint.searchParams.set("bases", bases.join(","));
      endpoint.searchParams.set("quote", quoteCode);

      const headers: Record<string, string> = { Accept: "application/json" };
      if (env.EXCHANGE_RATE_API_KEY) {
        headers.Authorization = `Bearer ${env.EXCHANGE_RATE_API_KEY}`;
      }

      const response = await fetch(endpoint, { headers, cache: "no-store" });
      if (!response.ok) {
        throw new AppError("FX_PROVIDER_HTTP", `FX API HTTP ${response.status}`, 503);
      }

      const body = (await response.json()) as Record<string, unknown>;
      return normalizeFxPayload(body, bases, quoteCode, "configured_fx_api");
    },
  };
}

export function normalizeFxPayload(
  body: Record<string, unknown>,
  bases: string[],
  quoteCode: string,
  providerName: string,
): FetchedRate[] {
  const out: FetchedRate[] = [];

  if (Array.isArray(body.rates)) {
    for (const row of body.rates) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const base = String(r.base ?? r.baseCode ?? "").toUpperCase();
      const quote = String(r.quote ?? r.quoteCode ?? quoteCode).toUpperCase();
      const rate = String(r.rate ?? "");
      if (!base || !rate || Number(rate) <= 0) continue;
      out.push({
        baseCode: base,
        quoteCode: quote,
        rate,
        marketTimestamp: parseTs(r.marketTimestamp ?? r.timestamp),
        providerName: String(body.provider ?? providerName),
      });
    }
    return filterRequested(out, bases, quoteCode);
  }

  if (body.rates && typeof body.rates === "object" && !Array.isArray(body.rates)) {
    const map = body.rates as Record<string, unknown>;
    const quote = quoteCode.toUpperCase();
    for (const base of bases) {
      const raw = map[base] ?? map[base.toUpperCase()];
      if (raw === undefined) continue;
      const rate = String(raw);
      if (Number(rate) <= 0) continue;
      out.push({
        baseCode: base.toUpperCase(),
        quoteCode: quote,
        rate,
        marketTimestamp: parseTs(body.marketTimestamp ?? body.timestamp),
        providerName: String(body.provider ?? providerName),
      });
    }
    return out;
  }

  throw new AppError("FX_PROVIDER_INVALID", "FX API returned invalid payload", 503);
}

function filterRequested(rows: FetchedRate[], bases: string[], quoteCode: string) {
  const wanted = new Set(bases.map((b) => b.toUpperCase()));
  return rows.filter(
    (r) => wanted.has(r.baseCode) && r.quoteCode === quoteCode.toUpperCase(),
  );
}

function parseTs(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return new Date(value);
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
