import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireVerifiedCustomer } from "@/lib/auth/session";
import { createReview } from "@/lib/services/reviews/service";

export async function POST(request: Request) {
  try {
    const customer = await requireVerifiedCustomer();
    const body = await request.json();
    const data = await createReview(customer, body);
    return apiSuccess(data, { status: 201 });
  } catch (error) {
    return apiFromUnknownError(error, "reviews.create");
  }
}
