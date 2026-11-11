import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/session";
import { listNotificationTemplates } from "@/lib/services/notifications/service";

export async function GET() {
  try {
    const actor = await requireAdmin();
    const data = await listNotificationTemplates(actor);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "admin.notification_templates.list");
  }
}
