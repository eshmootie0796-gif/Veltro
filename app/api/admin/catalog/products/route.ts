import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/session";
import { createProduct } from "@/lib/services/catalog/products";

export async function POST(request: Request) {
  try {
    const actor = await requireAdmin();
    const body = await request.json();
    const data = await createProduct(actor, body);
    return apiSuccess(data, { status: 201 });
  } catch (error) {
    return apiFromUnknownError(error, "admin.catalog.products.create");
  }
}
