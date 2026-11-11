import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { listPublicProducts } from "@/lib/services/catalog/products";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = Object.fromEntries(url.searchParams.entries());
    const data = await listPublicProducts(query);
    return apiSuccess(data.items, { meta: data.meta });
  } catch (error) {
    return apiFromUnknownError(error, "catalog.products.list");
  }
}
