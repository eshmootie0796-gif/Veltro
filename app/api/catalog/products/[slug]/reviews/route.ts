import { eq } from "drizzle-orm";
import { apiFromUnknownError, apiError, apiSuccess } from "@/lib/api/response";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import {
  getProductAverageRating,
  listApprovedProductReviews,
} from "@/lib/services/reviews/service";

type Params = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { slug } = await params;
    const product = await db.query.products.findFirst({ where: eq(products.slug, slug) });
    if (!product || product.deletedAt) {
      return apiError("NOT_FOUND", "Product not found", { status: 404 });
    }
    const [items, rating] = await Promise.all([
      listApprovedProductReviews(product.id),
      getProductAverageRating(product.id),
    ]);
    return apiSuccess(items, { meta: rating });
  } catch (error) {
    return apiFromUnknownError(error, "catalog.products.reviews");
  }
}
