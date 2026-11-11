import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requestEmailVerification } from "@/lib/services/auth/verification";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const data = await requestEmailVerification(body);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "auth.verify_email.request");
  }
}
