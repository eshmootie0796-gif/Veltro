import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/session";
import { deleteVariant, updateVariant } from "@/lib/services/catalog/variants";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const actor = await requireAdmin();
    const { id } = await params;
    const body = await request.json();
    const data = await updateVariant(actor, id, body);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "admin.catalog.variants.update");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const actor = await requireAdmin();
    const { id } = await params;
    const data = await deleteVariant(actor, id);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "admin.catalog.variants.delete");
  }
}
