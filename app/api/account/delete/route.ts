import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { ACCOUNT_DELETION_FORFEITURE_NOTICE } from "@/lib/auth/constants";
import { requireAuth } from "@/lib/auth/session";
import { deleteOwnAccount } from "@/lib/services/users/delete-account";

export async function GET() {
  return apiSuccess({
    notice: ACCOUNT_DELETION_FORFEITURE_NOTICE,
    requiredBody: {
      confirm: true,
      acknowledgeForfeiture: true,
      currentPassword: "string",
    },
  });
}

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    const body = await request.json();
    const data = await deleteOwnAccount(user.id, body);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "account.delete");
  }
}
