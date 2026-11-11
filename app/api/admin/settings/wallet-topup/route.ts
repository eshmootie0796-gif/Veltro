import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/session";
import { getTopupLimits, updateTopupLimits } from "@/lib/services/wallet/settings";

export async function GET() {
  try {
    await requireAdmin();
    const data = await getTopupLimits();
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "admin.settings.wallet_topup.get");
  }
}

export async function PUT(request: Request) {
  try {
    const actor = await requireAdmin();
    const body = await request.json();
    const data = await updateTopupLimits(actor, body);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "admin.settings.wallet_topup.put");
  }
}
