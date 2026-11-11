import { ValidationError } from "../../errors";
import { assertResolvedHostPublic, assertSafeHttpUrl } from "./ssrf";

export type ExtractedPrice = {
  amount: string;
  currency: string;
  source: "extracted" | "manual";
  storeKey: string | null;
};

const MAX_BYTES = 512_000;
const TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;

const STORE_PATTERNS: Array<{ key: string; hostIncludes: string }> = [
  { key: "amazon", hostIncludes: "amazon." },
  { key: "ebay", hostIncludes: "ebay." },
  { key: "aliexpress", hostIncludes: "aliexpress." },
];

function detectStore(hostname: string): string | null {
  const host = hostname.toLowerCase();
  for (const store of STORE_PATTERNS) {
    if (host.includes(store.hostIncludes)) return store.key;
  }
  return null;
}

function parseAmountCurrency(html: string): { amount: string; currency: string } | null {
  const metaPrice =
    html.match(/property=["']product:price:amount["'][^>]*content=["']([^"']+)["']/i) ??
    html.match(/content=["']([^"']+)["'][^>]*property=["']product:price:amount["']/i);
  const metaCurrency =
    html.match(/property=["']product:price:currency["'][^>]*content=["']([^"']+)["']/i) ??
    html.match(/content=["']([^"']+)["'][^>]*property=["']product:price:currency["']/i);
  if (metaPrice?.[1] && metaCurrency?.[1]) {
    return { amount: metaPrice[1], currency: metaCurrency[1].toUpperCase() };
  }

  const jsonLdMatch = html.match(
    /"@type"\s*:\s*"Product"[\s\S]{0,2000}?"price"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?[\s\S]{0,400}?"priceCurrency"\s*:\s*"([A-Z]{3})"/i,
  );
  if (jsonLdMatch?.[1] && jsonLdMatch[2]) {
    return { amount: jsonLdMatch[1], currency: jsonLdMatch[2].toUpperCase() };
  }
  return null;
}

async function fetchWithRedirectGuard(startUrl: URL): Promise<string> {
  let current = startUrl;
  for (let i = 0; i <= MAX_REDIRECTS; i += 1) {
    assertSafeHttpUrl(current.toString());
    await assertResolvedHostPublic(current.hostname);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(current.toString(), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "TehranPaymentPriceBot/1.0",
        },
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new ValidationError("Redirect without location");
        current = new URL(location, current);
        continue;
      }

      if (!response.ok) {
        throw new ValidationError(`Store responded with HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new ValidationError("Empty store response");
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BYTES) {
          throw new ValidationError("Store response too large");
        }
        chunks.push(value);
      }
      return Buffer.concat(chunks).toString("utf8");
    } finally {
      clearTimeout(timer);
    }
  }
  throw new ValidationError("Too many redirects");
}

/**
 * Attempt SSRF-safe price extraction. Caller falls back to manual fields on failure.
 */
export async function tryExtractProductPrice(productUrl: string): Promise<ExtractedPrice | null> {
  const url = assertSafeHttpUrl(productUrl);
  const storeKey = detectStore(url.hostname);
  try {
    const html = await fetchWithRedirectGuard(url);
    const parsed = parseAmountCurrency(html);
    if (!parsed) return null;
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(parsed.amount)) return null;
    if (!/^[A-Z]{3}$/.test(parsed.currency)) return null;
    return {
      amount: parsed.amount,
      currency: parsed.currency,
      source: "extracted",
      storeKey,
    };
  } catch (error) {
    if (error instanceof ValidationError) return null;
    return null;
  }
}
