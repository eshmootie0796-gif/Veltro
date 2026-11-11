import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireActiveAccount } from "@/lib/auth/session";
import { requestPasswordChangeVerification } from "@/lib/services/auth/password-change";

export async function POST() {
  try {
    const user = await requireActiveAccount();
    const data = await requestPasswordChangeVerification(user.id);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "auth.password_change.request_code");
  }
}
