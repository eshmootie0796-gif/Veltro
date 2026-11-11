import { apiFromUnknownError, apiError, apiSuccess } from "@/lib/api/response";
import {
  previewBuyQuote,
  previewConvertQuote,
  previewSellQuote,
} from "@/lib/services/crypto/trading";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const side = url.searchParams.get("side");
    const amount = url.searchParams.get("amount");
    if (!side || !amount) {
      return apiError("VALIDATION_ERROR", "side and amount required", { status: 400 });
    }

    if (side === "buy" || side === "sell") {
      const currencyCode = url.searchParams.get("currencyCode");
      if (!currencyCode) {
        return apiError("VALIDATION_ERROR", "currencyCode required", { status: 400 });
      }
      const data =
        side === "buy"
          ? await previewBuyQuote(currencyCode, amount)
          : await previewSellQuote(currencyCode, amount);
      return apiSuccess(data);
    }

    if (side === "convert") {
      const sourceCurrencyCode = url.searchParams.get("sourceCurrencyCode");
      const destinationCurrencyCode = url.searchParams.get("destinationCurrencyCode");
      if (!sourceCurrencyCode || !destinationCurrencyCode) {
        return apiError("VALIDATION_ERROR", "source and destination currency required", {
          status: 400,
        });
      }
      const data = await previewConvertQuote(
        sourceCurrencyCode,
        destinationCurrencyCode,
        amount,
      );
      return apiSuccess(data);
    }

    return apiError("VALIDATION_ERROR", "side must be buy|sell|convert", { status: 400 });
  } catch (error) {
    return apiFromUnknownError(error, "crypto.quote");
  }
}
