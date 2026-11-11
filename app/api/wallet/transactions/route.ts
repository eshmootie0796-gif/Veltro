import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireVerifiedCustomer } from "@/lib/auth/session";
import { listWalletTransactions } from "@/lib/services/wallet/service";

export async function GET(request: Request) {
  try {
    const customer = await requireVerifiedCustomer();
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? "50");
    const data = await listWalletTransactions(customer, limit);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "wallet.transactions");
  }
}
