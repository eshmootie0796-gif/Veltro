import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireSuperAdmin } from "@/lib/auth/session";
import { listAuditLogs } from "@/lib/services/admin/audit";

export async function GET(request: Request) {
  try {
    const actor = await requireSuperAdmin();
    const url = new URL(request.url);
    const query = Object.fromEntries(url.searchParams.entries());
    const data = await listAuditLogs(actor, query);
    return apiSuccess(data.items, { meta: data.meta });
  } catch (error) {
    return apiFromUnknownError(error, "admin.audit_logs.list");
  }
}
