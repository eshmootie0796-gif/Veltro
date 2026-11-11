import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireAdmin, requireSuperAdmin } from "@/lib/auth/session";
import {
  getPlatformSettings,
  updatePlatformSettings,
} from "@/lib/services/notifications/service";

export async function GET() {
  try {
    const actor = await requireAdmin();
    const data = await getPlatformSettings(actor);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "admin.settings.platform.get");
  }
}

export async function PUT(request: Request) {
  try {
    const actor = await requireSuperAdmin();
    const body = await request.json();
    const data = await updatePlatformSettings(actor, body);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "admin.settings.platform.put");
  }
}
