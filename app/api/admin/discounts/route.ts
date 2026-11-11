import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/session";
import { createDiscount, listDiscounts } from "@/lib/services/discounts/service";

export async function GET() {
  try {
    const actor = await requireAdmin();
    const data = await listDiscounts(actor);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "admin.discounts.list");
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireAdmin();
    const body = await request.json();
    const data = await createDiscount(actor, body);
    return apiSuccess(data, { status: 201 });
  } catch (error) {
    return apiFromUnknownError(error, "admin.discounts.create");
  }
}
