import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/session";
import { listReserves } from "@/lib/services/crypto/reserve";

export async function GET() {
  try {
    const actor = await requireAdmin();
    const data = await listReserves(actor);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "admin.crypto.reserves.list");
  }
}
