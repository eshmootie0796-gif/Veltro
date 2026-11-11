import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireVerifiedCustomer } from "@/lib/auth/session";
import { cancelUnpaidOrder } from "@/lib/services/orders/lifecycle";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  try {
    const customer = await requireVerifiedCustomer();
    const { id } = await params;
    const data = await cancelUnpaidOrder(customer, id);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "orders.cancel");
  }
}
