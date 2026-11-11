import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireVerifiedCustomer } from "@/lib/auth/session";
import { requestCancellation } from "@/lib/services/orders/lifecycle";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const customer = await requireVerifiedCustomer();
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { note?: string };
    const data = await requestCancellation(customer, id, body.note);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "orders.request_cancellation");
  }
}
