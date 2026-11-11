import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { getPricingAvailability } from "@/lib/pricing/availability";

export async function GET() {
  try {
    const data = await getPricingAvailability();
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "pricing.availability");
  }
}
