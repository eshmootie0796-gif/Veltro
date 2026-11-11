import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/session";
import { getCustomerAdmin } from "@/lib/services/admin/customers";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const actor = await requireAdmin();
    const { id } = await params;
    const data = await getCustomerAdmin(actor, id);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "admin.customers.get");
  }
}
