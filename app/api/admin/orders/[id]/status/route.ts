import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/session";
import { adminUpdateOrderStatus } from "@/lib/services/orders/lifecycle";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const actor = await requireAdmin();
    const { id } = await params;
    const body = await request.json();
    const data = await adminUpdateOrderStatus(actor, id, body);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "admin.orders.status");
  }
}
