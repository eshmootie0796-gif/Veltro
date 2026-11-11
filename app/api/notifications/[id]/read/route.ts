import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireVerifiedCustomer } from "@/lib/auth/session";
import { markNotificationRead } from "@/lib/services/notifications/service";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  try {
    const customer = await requireVerifiedCustomer();
    const { id } = await params;
    const data = await markNotificationRead(customer, id);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "notifications.read");
  }
}
