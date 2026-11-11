import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { ACCOUNT_DELETION_FORFEITURE_NOTICE } from "@/lib/auth/constants";
import { getSessionUser } from "@/lib/auth/session";

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) {
      return apiSuccess({ authenticated: false as const });
    }
    return apiSuccess({
      authenticated: true as const,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        status: user.status,
        emailVerified: Boolean(user.emailVerified),
      },
      accountDeletionNotice: ACCOUNT_DELETION_FORFEITURE_NOTICE,
    });
  } catch (error) {
    return apiFromUnknownError(error, "auth.me");
  }
}
