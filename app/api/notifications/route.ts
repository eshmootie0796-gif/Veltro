import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireVerifiedCustomer } from "@/lib/auth/session";
import { listMyNotifications, unreadCount } from "@/lib/services/notifications/service";

export async function GET(request: Request) {
  try {
    const customer = await requireVerifiedCustomer();
    const url = new URL(request.url);
    const unreadOnly = url.searchParams.get("unreadOnly") === "true";
    const limit = Number(url.searchParams.get("limit") ?? "50");
    const items = await listMyNotifications(customer, limit, unreadOnly);
    const unread = await unreadCount(customer.id);
    return apiSuccess(items, { meta: { unread } });
  } catch (error) {
    return apiFromUnknownError(error, "notifications.list");
  }
}
