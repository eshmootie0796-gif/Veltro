import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/session";
import { getAdminReports } from "@/lib/services/admin/reports";

export async function GET() {
  try {
    const actor = await requireAdmin();
    const data = await getAdminReports(actor);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "admin.reports");
  }
}
