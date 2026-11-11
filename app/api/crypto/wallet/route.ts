import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireVerifiedCustomer } from "@/lib/auth/session";
import { getCryptoWallet } from "@/lib/services/crypto/wallet";

export async function GET() {
  try {
    const customer = await requireVerifiedCustomer();
    const data = await getCryptoWallet(customer);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "crypto.wallet.get");
  }
}
