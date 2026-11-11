import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireVerifiedCustomer } from "@/lib/auth/session";
import { convertCrypto } from "@/lib/services/crypto/trading";

export async function POST(request: Request) {
  try {
    const customer = await requireVerifiedCustomer();
    const body = await request.json();
    const data = await convertCrypto(customer, body);
    return apiSuccess(data, { status: data.idempotentReplay ? 200 : 201 });
  } catch (error) {
    return apiFromUnknownError(error, "crypto.convert");
  }
}
