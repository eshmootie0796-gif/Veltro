import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/session";
import { refreshMarketRates } from "@/lib/pricing/refresh";

export async function POST() {
  try {
    await requireAdmin();
    const data = await refreshMarketRates();
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "admin.pricing.refresh");
  }
}
