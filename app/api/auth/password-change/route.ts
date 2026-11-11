import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireActiveAccount } from "@/lib/auth/session";
import { changePassword } from "@/lib/services/auth/password-change";

export async function POST(request: Request) {
  try {
    const user = await requireActiveAccount();
    const body = await request.json();
    const data = await changePassword(user.id, body);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "auth.password_change");
  }
}
