import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireVerifiedCustomer } from "@/lib/auth/session";
import { listCryptoTransactions } from "@/lib/services/crypto/wallet";

export async function GET(request: Request) {
  try {
    const customer = await requireVerifiedCustomer();
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? "50");
    const data = await listCryptoTransactions(customer, limit);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "crypto.transactions");
  }
}
