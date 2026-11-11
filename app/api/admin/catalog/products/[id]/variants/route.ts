import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/session";
import { createVariant, listVariants } from "@/lib/services/catalog/variants";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    await requireAdmin();
    const { id } = await params;
    const data = await listVariants(id);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "admin.catalog.variants.list");
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const actor = await requireAdmin();
    const { id } = await params;
    const body = await request.json();
    const data = await createVariant(actor, id, body);
    return apiSuccess(data, { status: 201 });
  } catch (error) {
    return apiFromUnknownError(error, "admin.catalog.variants.create");
  }
}
