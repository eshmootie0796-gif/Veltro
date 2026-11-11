import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireVerifiedCustomer } from "@/lib/auth/session";
import { createOrder } from "@/lib/services/orders/create";
import { listCustomerOrders } from "@/lib/services/orders/lifecycle";

export async function GET() {
  try {
    const customer = await requireVerifiedCustomer();
    const data = await listCustomerOrders(customer);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "orders.list");
  }
}

export async function POST(request: Request) {
  try {
    const customer = await requireVerifiedCustomer();
    const body = await request.json();
    const data = await createOrder(customer, body);
    return apiSuccess(data, { status: 201 });
  } catch (error) {
    return apiFromUnknownError(error, "orders.create");
  }
}
