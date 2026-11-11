import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { registerUser } from "@/lib/services/auth/register";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const data = await registerUser(body);
    return apiSuccess(data, { status: 201 });
  } catch (error) {
    return apiFromUnknownError(error, "auth.register");
  }
}
