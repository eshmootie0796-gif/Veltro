import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/session";
import { listAdminCategories } from "@/lib/services/catalog/categories";

export async function GET() {
  try {
    await requireAdmin();
    const data = await listAdminCategories();
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "admin.catalog.categories");
  }
}
