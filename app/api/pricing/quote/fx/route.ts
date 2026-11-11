import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { quoteFxPrice } from "@/lib/pricing/engine";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const data = await quoteFxPrice(body);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "pricing.quote.fx");
  }
}
