import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireVerifiedCustomer } from "@/lib/auth/session";
import { payOrder } from "@/lib/services/payments/service";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const customer = await requireVerifiedCustomer();
    const { id } = await params;
    const body = await request.json();
    const data = await payOrder(customer, id, body);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "orders.pay");
  }
}
