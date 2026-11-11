import type {
  categories,
  productConfigs,
  productFieldDefinitions,
  products,
  productVariants,
} from "../../db/schema";

type ProductRow = typeof products.$inferSelect;
type VariantRow = typeof productVariants.$inferSelect;
type FieldRow = typeof productFieldDefinitions.$inferSelect;
type ConfigRow = typeof productConfigs.$inferSelect;
type CategoryRow = typeof categories.$inferSelect;

export function mapCategory(row: CategoryRow) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    icon: row.icon,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
  };
}

export function mapVariant(row: VariantRow) {
  return {
    id: row.id,
    productId: row.productId,
    sku: row.sku,
    name: row.name,
    label: row.label,
    labelFa: row.labelFa,
    priceToman: row.priceToman,
    capacityMode: row.capacityMode,
    capacityTotal: row.capacityTotal,
    capacityRemaining: row.capacityRemaining,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
  };
}

export function mapField(row: FieldRow) {
  return {
    id: row.id,
    key: row.key,
    labelEn: row.labelEn,
    labelFa: row.labelFa,
    fieldType: row.fieldType,
    options: row.options,
    isRequired: row.isRequired,
    sortOrder: row.sortOrder,
    validation: row.validation,
    visibility: row.visibility,
  };
}

export function mapProduct(
  row: ProductRow,
  extras?: {
    category?: CategoryRow | null;
    variants?: VariantRow[];
    fields?: FieldRow[];
    config?: ConfigRow | null;
  },
) {
  return {
    id: row.id,
    categoryId: row.categoryId,
    category: extras?.category ? mapCategory(extras.category) : undefined,
    type: row.type,
    title: row.title,
    slug: row.slug,
    description: row.description,
    imageUrl: row.imageUrl,
    images: row.images,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    catalogKey: row.catalogKey,
    isCatalogLocked: row.isCatalogLocked,
    minOrderAmountToman: row.minOrderAmountToman,
    maxOrderAmountToman: row.maxOrderAmountToman,
    fixedAncillaryCostToman: row.fixedAncillaryCostToman,
    serviceFeeBps: row.serviceFeeBps,
    deletedAt: row.deletedAt,
    variants: (extras?.variants ?? []).filter((v) => !v.deletedAt).map(mapVariant),
    fields: (extras?.fields ?? []).map(mapField),
    config: extras?.config?.config ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
