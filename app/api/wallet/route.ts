import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireVerifiedCustomer } from "@/lib/auth/session";
import { getWallet } from "@/lib/services/wallet/service";

export async function GET() {
  try {
    const customer = await requireVerifiedCustomer();
    const data = await getWallet(customer);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "wallet.get");
  }
}
