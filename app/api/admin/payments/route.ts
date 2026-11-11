import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/session";
import { listPaymentsAdmin } from "@/lib/services/admin/payments";

export async function GET(request: Request) {
  try {
    const actor = await requireAdmin();
    const url = new URL(request.url);
    const query = Object.fromEntries(url.searchParams.entries());
    const data = await listPaymentsAdmin(actor, query);
    return apiSuccess(data.items, { meta: data.meta });
  } catch (error) {
    return apiFromUnknownError(error, "admin.payments.list");
  }
}
