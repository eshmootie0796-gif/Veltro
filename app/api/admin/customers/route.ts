import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/session";
import { listCustomers } from "@/lib/services/admin/customers";

export async function GET(request: Request) {
  try {
    const actor = await requireAdmin();
    const url = new URL(request.url);
    const query = Object.fromEntries(url.searchParams.entries());
    const data = await listCustomers(actor, query);
    return apiSuccess(data.items, { meta: data.meta });
  } catch (error) {
    return apiFromUnknownError(error, "admin.customers.list");
  }
}
