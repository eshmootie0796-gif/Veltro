import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/session";
import { updateNotificationTemplate } from "@/lib/services/notifications/service";

type Params = { params: Promise<{ slug: string }> };

export async function PUT(request: Request, { params }: Params) {
  try {
    const actor = await requireAdmin();
    const { slug } = await params;
    const body = await request.json();
    const data = await updateNotificationTemplate(actor, slug, body);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "admin.notification_templates.update");
  }
}
