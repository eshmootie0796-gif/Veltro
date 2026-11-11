import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/session";
import { listFields, replaceFields } from "@/lib/services/catalog/fields";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    await requireAdmin();
    const { id } = await params;
    const data = await listFields(id);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "admin.catalog.fields.list");
  }
}

export async function PUT(request: Request, { params }: Params) {
  try {
    const actor = await requireAdmin();
    const { id } = await params;
    const body = await request.json();
    const data = await replaceFields(actor, id, body);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "admin.catalog.fields.replace");
  }
}
