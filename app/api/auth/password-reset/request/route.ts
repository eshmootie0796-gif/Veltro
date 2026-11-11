import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requestPasswordReset } from "@/lib/services/auth/password-reset";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const data = await requestPasswordReset(body);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "auth.password_reset.request");
  }
}
