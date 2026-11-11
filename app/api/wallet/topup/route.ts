import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireVerifiedCustomer } from "@/lib/auth/session";
import { mockWalletTopup } from "@/lib/services/wallet/service";

export async function POST(request: Request) {
  try {
    const customer = await requireVerifiedCustomer();
    const body = await request.json();
    const data = await mockWalletTopup(customer, body);
    return apiSuccess(data, { status: data.status === "succeeded" ? 201 : 200 });
  } catch (error) {
    return apiFromUnknownError(error, "wallet.topup");
  }
}
