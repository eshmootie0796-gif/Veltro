import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/session";
import { listRateFeeds } from "@/lib/pricing/rate-store";
import { getPricingAvailability } from "@/lib/pricing/availability";

export async function GET() {
  try {
    await requireAdmin();
    const [feeds, availability] = await Promise.all([listRateFeeds(), getPricingAvailability()]);
    return apiSuccess({
      feeds: feeds.map((f) => ({
        providerKey: f.providerKey,
        providerName: f.providerName,
        baseCode: f.baseCode,
        quoteCode: f.quoteCode,
        rate: f.validationStatus === "valid" ? f.rate : null,
        retrievedAt: f.retrievedAt,
        marketTimestamp: f.marketTimestamp,
        validationStatus: f.validationStatus,
        lastError: f.lastError,
        updatedAt: f.updatedAt,
      })),
      availability,
    });
  } catch (error) {
    return apiFromUnknownError(error, "admin.pricing.rates");
  }
}
