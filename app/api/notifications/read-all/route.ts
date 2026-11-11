import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireVerifiedCustomer } from "@/lib/auth/session";
import { markAllNotificationsRead } from "@/lib/services/notifications/service";

export async function POST() {
  try {
    const customer = await requireVerifiedCustomer();
    const data = await markAllNotificationsRead(customer);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "notifications.read_all");
  }
}
