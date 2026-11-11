import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireSuperAdmin } from "@/lib/auth/session";
import { assignUserRole } from "@/lib/services/users/roles";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const actor = await requireSuperAdmin();
    const { id } = await params;
    const body = await request.json();
    const data = await assignUserRole(actor, id, body);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "admin.users.role");
  }
}
