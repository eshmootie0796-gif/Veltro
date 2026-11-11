import { z } from "zod";
import { CATEGORY_SLUGS, type CategorySlug } from "./constants";
import { ValidationError } from "../errors";

const visaMastercardConfigSchema = z.object({
  cardBrands: z.array(z.enum(["visa", "mastercard"])).min(1),
  formFactors: z.array(z.enum(["physical", "virtual"])).min(1),
  cardTypes: z.array(z.enum(["prepaid", "debit", "credit"])).min(1),
  issuingCountries: z.array(z.string().min(2).max(80)).default([]),
  amountMode: z.enum(["fixed_plans", "custom_amount", "both"]).default("both"),
  allowedCurrencies: z.array(z.string().toUpperCase()).default(["USD"]),
  extra: z.record(z.unknown()).default({}),
});

const giftCardsConfigSchema = z.object({
  brand: z.string().min(1),
  countryOrRegion: z.string().optional(),
  productType: z.string().optional(),
  supportsStarsQuantity: z.boolean().default(false),
  supportsSubscriptionDuration: z.boolean().default(false),
  denominations: z.array(z.number().positive()).default([]),
  allowedCurrencies: z.array(z.string().toUpperCase()).default(["USD"]),
  extra: z.record(z.unknown()).default({}),
});

const aiSubscriptionsConfigSchema = z.object({
  group: z.string().min(1),
  personalAccountOnly: z.literal(true).default(true),
  neverCollectPassword: z.literal(true).default(true),
  noSharedAccounts: z.literal(true).default(true),
});

const cryptocurrencyConfigSchema = z.object({
  supportedAssets: z.array(z.string().min(1)).default([]),
  useInternalTradingEngine: z.literal(true).default(true),
  extra: z.record(z.unknown()).default({}),
});

const paypalConfigSchema = z.object({
  service: z.enum(["top-up", "send-money", "receive-money"]),
  currencies: z.array(z.string().min(3).max(10)).min(1),
  minAmount: z.number().nonnegative().optional(),
  maxAmount: z.number().positive().optional(),
  feeBps: z.number().int().min(0).max(10000).optional(),
  extra: z.record(z.unknown()).default({}),
});

const internationalShoppingConfigSchema = z.object({
  stores: z
    .array(
      z.object({
        key: z.string().min(1),
        name: z.string().min(1),
        urlPattern: z.string().optional(),
      }),
    )
    .default([]),
  extractionEnabled: z.boolean().default(true),
  requireManualPriceIfExtractionFails: z.boolean().default(true),
  extra: z.record(z.unknown()).default({}),
});

const gamePurchasesConfigSchema = z.object({
  gameKey: z.string().min(1),
  gameName: z.string().min(1),
  packageUnit: z.string().optional(),
  requiresPlayerId: z.boolean().default(true),
  requiresServerOrRegion: z.boolean().default(false),
  allowedCurrencies: z.array(z.string().toUpperCase()).default(["USD"]),
  extra: z.record(z.unknown()).default({}),
});

const hotelConfigSchema = z.object({
  kind: z.literal("hotel"),
  roomNightPrices: z
    .array(
      z.object({
        roomType: z.string().min(1),
        hotelGrade: z.string().optional(),
        priceTomanPerNight: z.number().int().nonnegative(),
      }),
    )
    .min(1),
  notes: z.string().optional(),
  extra: z.record(z.unknown()).default({}),
});

const flightConfigSchema = z.object({
  kind: z.literal("flight"),
  routes: z
    .array(
      z.object({
        origin: z.string().min(1),
        destination: z.string().min(1),
        adultBasePriceToman: z.number().int().nonnegative(),
      }),
    )
    .min(1),
  childRatio: z.number().min(0).max(1).default(0.75),
  cabinMultipliers: z
    .object({
      economy: z.number().positive().default(1),
      business: z.number().positive().default(1.8),
      first: z.number().positive().default(2.5),
    })
    .default({ economy: 1, business: 1.8, first: 2.5 }),
  roundTripMultiplier: z.number().positive().default(1.85),
  notes: z.string().optional(),
  extra: z.record(z.unknown()).default({}),
});

const hotelsFlightsConfigSchema = z.discriminatedUnion("kind", [
  hotelConfigSchema,
  flightConfigSchema,
  z.object({
    kind: z.literal("other"),
    notes: z.string().optional(),
    extra: z.record(z.unknown()).default({}),
  }),
]);

const CONFIG_SCHEMAS: Record<CategorySlug, z.ZodTypeAny> = {
  [CATEGORY_SLUGS.visaMastercard]: visaMastercardConfigSchema,
  [CATEGORY_SLUGS.giftCardsPremium]: giftCardsConfigSchema,
  [CATEGORY_SLUGS.aiSubscriptions]: aiSubscriptionsConfigSchema,
  [CATEGORY_SLUGS.cryptocurrency]: cryptocurrencyConfigSchema,
  [CATEGORY_SLUGS.paypalServices]: paypalConfigSchema,
  [CATEGORY_SLUGS.internationalShopping]: internationalShoppingConfigSchema,
  [CATEGORY_SLUGS.inAppGamePurchases]: gamePurchasesConfigSchema,
  [CATEGORY_SLUGS.hotelsFlights]: hotelsFlightsConfigSchema,
};

export function parseCategoryConfig(categorySlug: string, config: unknown) {
  const schema = CONFIG_SCHEMAS[categorySlug as CategorySlug];
  if (!schema) {
    throw new ValidationError(`Unknown category slug: ${categorySlug}`);
  }
  const result = schema.safeParse(config ?? {});
  if (!result.success) {
    throw new ValidationError("Invalid product config for category", result.error.flatten());
  }
  return result.data as Record<string, unknown>;
}

type FieldSeed = {
  key: string;
  labelEn: string;
  labelFa: string;
  fieldType: "text" | "email" | "number" | "select" | "date" | "url" | "textarea";
  isRequired: boolean;
  sortOrder: number;
  options: Array<{ value: string; labelEn: string; labelFa: string }>;
  validation: Record<string, unknown>;
  visibility: null | { fieldKey: string; equals?: string; in?: string[] };
};

export function defaultFieldsForCategory(categorySlug: string): FieldSeed[] {
  switch (categorySlug) {
    case CATEGORY_SLUGS.aiSubscriptions:
      return [
        {
          key: "plan",
          labelEn: "Plan",
          labelFa: "پلن",
          fieldType: "text",
          isRequired: true,
          sortOrder: 0,
          options: [],
          validation: { minLength: 1, maxLength: 80 },
          visibility: null,
        },
        {
          key: "duration",
          labelEn: "Duration",
          labelFa: "مدت",
          fieldType: "text",
          isRequired: true,
          sortOrder: 1,
          options: [],
          validation: { minLength: 1, maxLength: 80 },
          visibility: null,
        },
        {
          key: "account_email",
          labelEn: "Account email",
          labelFa: "ایمیل حساب",
          fieldType: "email",
          isRequired: true,
          sortOrder: 2,
          options: [],
          validation: {},
          visibility: null,
        },
        {
          key: "notes",
          labelEn: "Notes",
          labelFa: "توضیحات",
          fieldType: "textarea",
          isRequired: false,
          sortOrder: 3,
          options: [],
          validation: { maxLength: 2000 },
          visibility: null,
        },
      ];
    case CATEGORY_SLUGS.giftCardsPremium:
      return [
        {
          key: "denomination",
          labelEn: "Denomination",
          labelFa: "مبلغ کارت",
          fieldType: "number",
          isRequired: false,
          sortOrder: 0,
          options: [],
          validation: { min: 0 },
          visibility: null,
        },
        {
          key: "subscription_duration",
          labelEn: "Subscription duration",
          labelFa: "مدت اشتراک",
          fieldType: "text",
          isRequired: false,
          sortOrder: 1,
          options: [],
          validation: { maxLength: 80 },
          visibility: null,
        },
        {
          key: "stars_quantity",
          labelEn: "Stars quantity",
          labelFa: "تعداد استارز",
          fieldType: "number",
          isRequired: false,
          sortOrder: 2,
          options: [],
          validation: { min: 1 },
          visibility: null,
        },
      ];
    case CATEGORY_SLUGS.paypalServices:
      return [
        {
          key: "paypal_email",
          labelEn: "PayPal email / account",
          labelFa: "ایمیل پی‌پال",
          fieldType: "email",
          isRequired: true,
          sortOrder: 0,
          options: [],
          validation: {},
          visibility: null,
        },
        {
          key: "amount",
          labelEn: "Amount",
          labelFa: "مبلغ",
          fieldType: "number",
          isRequired: true,
          sortOrder: 1,
          options: [],
          validation: { min: 0 },
          visibility: null,
        },
        {
          key: "currency",
          labelEn: "Currency",
          labelFa: "ارز",
          fieldType: "text",
          isRequired: true,
          sortOrder: 2,
          options: [],
          validation: { minLength: 3, maxLength: 10 },
          visibility: null,
        },
        {
          key: "notes",
          labelEn: "Notes",
          labelFa: "توضیحات",
          fieldType: "textarea",
          isRequired: false,
          sortOrder: 3,
          options: [],
          validation: { maxLength: 2000 },
          visibility: null,
        },
      ];
    case CATEGORY_SLUGS.cryptocurrency:
      return [
        {
          key: "crypto_symbol",
          labelEn: "Asset",
          labelFa: "دارایی",
          fieldType: "text",
          isRequired: true,
          sortOrder: 0,
          options: [],
          validation: { minLength: 2, maxLength: 16 },
          visibility: null,
        },
        {
          key: "crypto_amount",
          labelEn: "Amount",
          labelFa: "مقدار",
          fieldType: "text",
          isRequired: true,
          sortOrder: 1,
          options: [],
          validation: { minLength: 1, maxLength: 64 },
          visibility: null,
        },
      ];
    case CATEGORY_SLUGS.internationalShopping:
      return [
        {
          key: "product_url",
          labelEn: "Product URL",
          labelFa: "لینک محصول",
          fieldType: "url",
          isRequired: true,
          sortOrder: 0,
          options: [],
          validation: {},
          visibility: null,
        },
        {
          key: "product_price",
          labelEn: "Product price",
          labelFa: "قیمت محصول",
          fieldType: "number",
          isRequired: false,
          sortOrder: 1,
          options: [],
          validation: { min: 0 },
          visibility: null,
        },
        {
          key: "product_currency",
          labelEn: "Product currency",
          labelFa: "ارز محصول",
          fieldType: "text",
          isRequired: false,
          sortOrder: 2,
          options: [],
          validation: { minLength: 3, maxLength: 10 },
          visibility: null,
        },
        {
          key: "shipping_foreign",
          labelEn: "Shipping",
          labelFa: "هزینه ارسال",
          fieldType: "number",
          isRequired: false,
          sortOrder: 3,
          options: [],
          validation: { min: 0 },
          visibility: null,
        },
        {
          key: "tax_foreign",
          labelEn: "Tax",
          labelFa: "مالیات",
          fieldType: "number",
          isRequired: false,
          sortOrder: 4,
          options: [],
          validation: { min: 0 },
          visibility: null,
        },
        {
          key: "customs_foreign",
          labelEn: "Customs",
          labelFa: "گمرک",
          fieldType: "number",
          isRequired: false,
          sortOrder: 5,
          options: [],
          validation: { min: 0 },
          visibility: null,
        },
        {
          key: "size",
          labelEn: "Size",
          labelFa: "سایز",
          fieldType: "text",
          isRequired: false,
          sortOrder: 6,
          options: [],
          validation: {},
          visibility: null,
        },
        {
          key: "color",
          labelEn: "Color",
          labelFa: "رنگ",
          fieldType: "text",
          isRequired: false,
          sortOrder: 7,
          options: [],
          validation: {},
          visibility: null,
        },
        {
          key: "quantity",
          labelEn: "Quantity",
          labelFa: "تعداد",
          fieldType: "number",
          isRequired: true,
          sortOrder: 8,
          options: [],
          validation: { min: 1 },
          visibility: null,
        },
        {
          key: "notes",
          labelEn: "Notes",
          labelFa: "توضیحات",
          fieldType: "textarea",
          isRequired: false,
          sortOrder: 9,
          options: [],
          validation: { maxLength: 2000 },
          visibility: null,
        },
      ];
    case CATEGORY_SLUGS.inAppGamePurchases:
      return [
        {
          key: "player_id",
          labelEn: "Player ID",
          labelFa: "شناسه بازیکن",
          fieldType: "text",
          isRequired: true,
          sortOrder: 0,
          options: [],
          validation: { minLength: 1, maxLength: 128 },
          visibility: null,
        },
        {
          key: "server_or_region",
          labelEn: "Server or region",
          labelFa: "سرور یا منطقه",
          fieldType: "text",
          isRequired: false,
          sortOrder: 1,
          options: [],
          validation: { maxLength: 128 },
          visibility: null,
        },
      ];
    case CATEGORY_SLUGS.visaMastercard:
      return [
        {
          key: "card_brand",
          labelEn: "Card brand",
          labelFa: "برند کارت",
          fieldType: "select",
          isRequired: true,
          sortOrder: 0,
          options: [
            { value: "visa", labelEn: "Visa", labelFa: "ویزا" },
            { value: "mastercard", labelEn: "Mastercard", labelFa: "مسترکارت" },
          ],
          validation: {},
          visibility: null,
        },
        {
          key: "form_factor",
          labelEn: "Physical or virtual",
          labelFa: "فیزیکی یا مجازی",
          fieldType: "select",
          isRequired: true,
          sortOrder: 1,
          options: [
            { value: "physical", labelEn: "Physical", labelFa: "فیزیکی" },
            { value: "virtual", labelEn: "Virtual", labelFa: "مجازی" },
          ],
          validation: {},
          visibility: null,
        },
        {
          key: "card_type",
          labelEn: "Card type",
          labelFa: "نوع کارت",
          fieldType: "select",
          isRequired: true,
          sortOrder: 2,
          options: [
            { value: "prepaid", labelEn: "Prepaid", labelFa: "پیش‌پرداخت" },
            { value: "debit", labelEn: "Debit", labelFa: "نقدی" },
            { value: "credit", labelEn: "Credit", labelFa: "اعتباری" },
          ],
          validation: {},
          visibility: null,
        },
        {
          key: "issuing_country",
          labelEn: "Issuing country",
          labelFa: "کشور صادرکننده",
          fieldType: "text",
          isRequired: true,
          sortOrder: 3,
          options: [],
          validation: { minLength: 2, maxLength: 80 },
          visibility: null,
        },
        {
          key: "custom_amount",
          labelEn: "Custom amount",
          labelFa: "مبلغ دلخواه",
          fieldType: "number",
          isRequired: false,
          sortOrder: 4,
          options: [],
          validation: { min: 0 },
          visibility: null,
        },
        {
          key: "custom_currency",
          labelEn: "Custom currency",
          labelFa: "ارز دلخواه",
          fieldType: "text",
          isRequired: false,
          sortOrder: 5,
          options: [],
          validation: { minLength: 3, maxLength: 10 },
          visibility: null,
        },
      ];
    case CATEGORY_SLUGS.hotelsFlights:
      return [
        // Hotel fields
        {
          key: "destination_city",
          labelEn: "Destination city",
          labelFa: "شهر مقصد",
          fieldType: "text",
          isRequired: false,
          sortOrder: 0,
          options: [],
          validation: { maxLength: 120 },
          visibility: null,
        },
        {
          key: "hotel_name",
          labelEn: "Selected hotel",
          labelFa: "هتل",
          fieldType: "text",
          isRequired: false,
          sortOrder: 1,
          options: [],
          validation: { maxLength: 160 },
          visibility: null,
        },
        {
          key: "check_in",
          labelEn: "Check-in date",
          labelFa: "تاریخ ورود",
          fieldType: "date",
          isRequired: false,
          sortOrder: 2,
          options: [],
          validation: {},
          visibility: null,
        },
        {
          key: "check_out",
          labelEn: "Check-out date",
          labelFa: "تاریخ خروج",
          fieldType: "date",
          isRequired: false,
          sortOrder: 3,
          options: [],
          validation: {},
          visibility: null,
        },
        {
          key: "room_count",
          labelEn: "Room count",
          labelFa: "تعداد اتاق",
          fieldType: "number",
          isRequired: false,
          sortOrder: 4,
          options: [],
          validation: { min: 1 },
          visibility: null,
        },
        {
          key: "adult_count",
          labelEn: "Adult count",
          labelFa: "تعداد بزرگسال",
          fieldType: "number",
          isRequired: false,
          sortOrder: 5,
          options: [],
          validation: { min: 0 },
          visibility: null,
        },
        {
          key: "child_count",
          labelEn: "Child count",
          labelFa: "تعداد کودک",
          fieldType: "number",
          isRequired: false,
          sortOrder: 6,
          options: [],
          validation: { min: 0 },
          visibility: null,
        },
        {
          key: "room_type",
          labelEn: "Room type / hotel grade",
          labelFa: "نوع اتاق",
          fieldType: "text",
          isRequired: false,
          sortOrder: 7,
          options: [],
          validation: { maxLength: 80 },
          visibility: null,
        },
        // Flight fields
        {
          key: "origin",
          labelEn: "Origin",
          labelFa: "مبدا",
          fieldType: "text",
          isRequired: false,
          sortOrder: 10,
          options: [],
          validation: { maxLength: 80 },
          visibility: null,
        },
        {
          key: "destination",
          labelEn: "Destination",
          labelFa: "مقصد",
          fieldType: "text",
          isRequired: false,
          sortOrder: 11,
          options: [],
          validation: { maxLength: 80 },
          visibility: null,
        },
        {
          key: "departure_date",
          labelEn: "Departure date",
          labelFa: "تاریخ رفت",
          fieldType: "date",
          isRequired: false,
          sortOrder: 12,
          options: [],
          validation: {},
          visibility: null,
        },
        {
          key: "return_date",
          labelEn: "Return date",
          labelFa: "تاریخ برگشت",
          fieldType: "date",
          isRequired: false,
          sortOrder: 13,
          options: [],
          validation: {},
          visibility: null,
        },
        {
          key: "cabin_class",
          labelEn: "Cabin class",
          labelFa: "کلاس پرواز",
          fieldType: "select",
          isRequired: false,
          sortOrder: 14,
          options: [
            { value: "economy", labelEn: "Economy", labelFa: "اکونومی" },
            { value: "business", labelEn: "Business", labelFa: "بیزینس" },
            { value: "first", labelEn: "First", labelFa: "فرست" },
          ],
          validation: {},
          visibility: null,
        },
        {
          key: "trip_type",
          labelEn: "Trip type",
          labelFa: "نوع سفر",
          fieldType: "select",
          isRequired: false,
          sortOrder: 15,
          options: [
            { value: "one_way", labelEn: "One-way", labelFa: "یک‌طرفه" },
            { value: "round_trip", labelEn: "Round-trip", labelFa: "رفت‌وبرگشت" },
          ],
          validation: {},
          visibility: null,
        },
      ];
    default:
      return [];
  }
}
