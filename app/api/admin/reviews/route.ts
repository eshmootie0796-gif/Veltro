import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/session";
import { listPendingReviews } from "@/lib/services/reviews/service";

export async function GET() {
  try {
    const actor = await requireAdmin();
    const data = await listPendingReviews(actor);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "admin.reviews.list");
  }
}
