import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { getPublicProductBySlug } from "@/lib/services/catalog/products";

type Params = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { slug } = await params;
    const data = await getPublicProductBySlug(slug);
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error, "catalog.products.get");
  }
}
