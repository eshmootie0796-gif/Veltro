import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { confirmPasswordReset } from "@/lib/services/auth/password-reset";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const data = await confirmPasswordReset(body);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "auth.password_reset.confirm");
  }
}
