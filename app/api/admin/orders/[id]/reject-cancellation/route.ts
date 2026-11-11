import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/session";
import { adminRejectCancellation } from "@/lib/services/orders/lifecycle";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const actor = await requireAdmin();
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { note?: string };
    const data = await adminRejectCancellation(
      actor,
      id,
      body.note ?? "Cancellation rejected by admin",
    );
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "admin.orders.reject_cancellation");
  }
}
