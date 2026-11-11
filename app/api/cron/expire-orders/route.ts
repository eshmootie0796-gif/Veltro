import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { authorizeCron } from "@/lib/server/cron-auth";
import { expireUnpaidOrders } from "@/lib/services/orders/lifecycle";
import { releaseExpiredReservations } from "@/lib/services/jobs/maintenance";

/**
 * Expire unpaid orders + sweep expired capacity/discount reservations.
 * Idempotent. Prefer /api/cron/maintenance on a single 5-minute schedule.
 */
async function run(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : 50;
  const orderLimit =
    Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : 50;

  const expire = await expireUnpaidOrders(orderLimit);
  const reservations = await releaseExpiredReservations(orderLimit);
  return apiSuccess({ expire, reservations });
}

export async function GET(request: Request) {
  try {
    return await run(request);
  } catch (error) {
    return apiFromUnknownError(error, "cron.expire_orders");
  }
}

export async function POST(request: Request) {
  try {
    return await run(request);
  } catch (error) {
    return apiFromUnknownError(error, "cron.expire_orders");
  }
}
