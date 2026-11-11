import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireSuperAdmin } from "@/lib/auth/session";
import { createAdminAccount } from "@/lib/services/users/roles";

export async function POST(request: Request) {
  try {
    const actor = await requireSuperAdmin();
    const body = await request.json();
    const data = await createAdminAccount(actor, body);
    return apiSuccess(data, { status: 201 });
  } catch (error) {
    return apiFromUnknownError(error, "admin.admins.create");
  }
}
