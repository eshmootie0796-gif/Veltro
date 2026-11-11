import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/session";
import {
  deleteProduct,
  getAdminProduct,
  updateProduct,
} from "@/lib/services/catalog/products";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    await requireAdmin();
    const { id } = await params;
    const data = await getAdminProduct(id);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "admin.catalog.products.get");
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const actor = await requireAdmin();
    const { id } = await params;
    const body = await request.json();
    const data = await updateProduct(actor, id, body);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "admin.catalog.products.update");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const actor = await requireAdmin();
    const { id } = await params;
    const data = await deleteProduct(actor, id);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "admin.catalog.products.delete");
  }
}
