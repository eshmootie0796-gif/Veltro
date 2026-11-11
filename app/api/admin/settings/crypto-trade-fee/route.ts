import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/session";
import { getTradeFeeBps, updateTradeFeeBps } from "@/lib/services/crypto/settings";

export async function GET() {
  try {
    await requireAdmin();
    const feeBps = await getTradeFeeBps();
    return apiSuccess({ feeBps });
  } catch (error) {
    return apiFromUnknownError(error, "admin.settings.crypto_trade_fee.get");
  }
}

export async function PUT(request: Request) {
  try {
    const actor = await requireAdmin();
    const body = await request.json();
    const data = await updateTradeFeeBps(actor, body);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "admin.settings.crypto_trade_fee.put");
  }
}
