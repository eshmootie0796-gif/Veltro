import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { confirmEmailVerification } from "@/lib/services/auth/verification";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const data = await confirmEmailVerification(body);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "auth.verify_email.confirm");
  }
}
