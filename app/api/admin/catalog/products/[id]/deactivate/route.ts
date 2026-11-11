import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/session";
import { setProductActive } from "@/lib/services/catalog/products";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  try {
    const actor = await requireAdmin();
    const { id } = await params;
    const data = await setProductActive(actor, id, false);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "admin.catalog.products.deactivate");
  }
}
