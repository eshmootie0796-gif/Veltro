import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/session";
import { getOrderAdmin } from "@/lib/services/orders/lifecycle";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const actor = await requireAdmin();
    const { id } = await params;
    const data = await getOrderAdmin(actor, id);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "admin.orders.get");
  }
}
