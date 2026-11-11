import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { listPublicCategories } from "@/lib/services/catalog/categories";

export async function GET() {
  try {
    const data = await listPublicCategories();
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "catalog.categories.list");
  }
}
