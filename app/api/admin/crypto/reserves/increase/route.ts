import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/session";
import { adminIncreaseReserve } from "@/lib/services/crypto/reserve";

export async function POST(request: Request) {
  try {
    const actor = await requireAdmin();
    const body = await request.json();
    const data = await adminIncreaseReserve(actor, body);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "admin.crypto.reserves.increase");
  }
}
