import { apiFromUnknownError, apiSuccess } from "@/lib/api/response";
import { getPublicProductBySlug } from "@/lib/services/catalog/products";
import { validateProductFieldValues } from "@/lib/services/catalog/fields";

type Params = { params: Promise<{ slug: string }> };

/** Public helper to validate dynamic fields before order placement. */
export async function POST(request: Request, { params }: Params) {
  try {
    const { slug } = await params;
    const product = await getPublicProductBySlug(slug);
    const body = (await request.json()) as { values?: Record<string, unknown> };
    const values = body.values ?? {};
    const data = await validateProductFieldValues(product.id, values);
    return apiSuccess({ values: data });
  } catch (error) {
    return apiFromUnknownError(error, "catalog.products.validate_fields");
  }
}
