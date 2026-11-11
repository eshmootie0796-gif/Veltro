import { CATEGORY_SLUGS, type CategorySlug } from "../../../catalog/constants";
import { parseCategoryConfig } from "../../../catalog/category-configs";
import { ValidationError } from "../../../errors";
import {
  quoteCryptoPrice,
  quoteFixedTomanPrice,
  quoteFxPrice,
  type PricingSnapshot,
} from "../../../pricing/engine";
import { d, toTomanInt } from "../../../money/decimal";
import { assertSafeHttpUrl } from "../../shopping/ssrf";
import { tryExtractProductPrice } from "../../shopping/extract-price";
import { getTradeFeeBps } from "../../crypto/settings";
import { applyBuyFee, quoteCryptoToToman } from "../../crypto/pricing";

export type CategoryOrderInput = {
  categorySlug: string;
  productTitle: string;
  catalogKey: string | null;
  config: Record<string, unknown> | null | undefined;
  variantName: string;
  variantPriceToman: number;
  serviceFeeBps: number;
  fixedAncillaryCostToman: number;
  minOrderAmountToman: number | null;
  maxOrderAmountToman: number | null;
  quantity: number;
  fieldValues: Record<string, unknown>;
  pricing: {
    mode: "fixed_irt" | "fx" | "crypto";
    foreignAmount?: string;
    foreignCurrency?: string;
    shippingForeign?: string;
    taxForeign?: string;
    customsForeign?: string;
    cryptoAmount?: string;
    cryptoSymbol?: string;
  };
};

export type CategoryOrderResolution = {
  fieldValues: Record<string, unknown>;
  snapshot: PricingSnapshot;
  fulfillment: {
    type: "manual" | "crypto_reserve";
    cryptoSymbol?: string;
    cryptoAmount?: string;
  };
};

const PASSWORD_KEY = /password|passwd|pwd|secret/i;

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return null;
}

function requireDate(value: unknown, label: string): Date {
  const raw = asString(value);
  if (!raw) throw new ValidationError(`${label} is required`);
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new ValidationError(`${label} is invalid`);
  return date;
}

function nightsBetween(checkIn: Date, checkOut: Date): number {
  const ms = checkOut.getTime() - checkIn.getTime();
  const nights = Math.round(ms / (24 * 60 * 60 * 1000));
  if (nights < 1) throw new ValidationError("Check-out must be after check-in");
  return nights;
}

function rejectPasswords(fieldValues: Record<string, unknown>) {
  for (const key of Object.keys(fieldValues)) {
    if (PASSWORD_KEY.test(key)) {
      throw new ValidationError("Password fields are not allowed");
    }
  }
}

export async function resolveCategoryOrder(
  input: CategoryOrderInput,
): Promise<CategoryOrderResolution> {
  const slug = input.categorySlug as CategorySlug;
  const config = parseCategoryConfig(slug, input.config ?? {});
  const fieldValues = { ...input.fieldValues };
  rejectPasswords(fieldValues);

  switch (slug) {
    case CATEGORY_SLUGS.visaMastercard:
      return resolveVisa(input, config, fieldValues);
    case CATEGORY_SLUGS.giftCardsPremium:
      return resolveGift(input, config, fieldValues);
    case CATEGORY_SLUGS.aiSubscriptions:
      return resolveAi(input, fieldValues);
    case CATEGORY_SLUGS.paypalServices:
      return resolvePaypal(input, config, fieldValues);
    case CATEGORY_SLUGS.internationalShopping:
      return resolveShopping(input, config, fieldValues);
    case CATEGORY_SLUGS.inAppGamePurchases:
      return resolveGame(input, config, fieldValues);
    case CATEGORY_SLUGS.cryptocurrency:
      return resolveCrypto(input, config, fieldValues);
    case CATEGORY_SLUGS.hotelsFlights:
      return resolveHotelsFlights(input, config, fieldValues);
    default: {
      const _never: never = slug;
      throw new ValidationError(`Unsupported category: ${String(_never)}`);
    }
  }
}

async function resolveVisa(
  input: CategoryOrderInput,
  config: Record<string, unknown>,
  fieldValues: Record<string, unknown>,
): Promise<CategoryOrderResolution> {
  const brands = (config.cardBrands as string[]) ?? [];
  const forms = (config.formFactors as string[]) ?? [];
  const types = (config.cardTypes as string[]) ?? [];
  const countries = (config.issuingCountries as string[]) ?? [];
  const amountMode = (config.amountMode as string) ?? "both";
  const allowedCurrencies = (config.allowedCurrencies as string[]) ?? ["USD"];

  const brand = asString(fieldValues.card_brand);
  const form = asString(fieldValues.form_factor);
  const cardType = asString(fieldValues.card_type);
  const country = asString(fieldValues.issuing_country);
  if (!brand || !brands.includes(brand)) throw new ValidationError("Invalid card brand");
  if (!form || !forms.includes(form)) throw new ValidationError("Invalid form factor");
  if (!cardType || !types.includes(cardType)) throw new ValidationError("Invalid card type");
  if (!country) throw new ValidationError("Issuing country required");
  if (countries.length > 0 && !countries.includes(country)) {
    throw new ValidationError("Issuing country not allowed");
  }

  const customAmount = asNumber(fieldValues.custom_amount);
  const customCurrency = asString(fieldValues.custom_currency)?.toUpperCase();

  let snapshot: PricingSnapshot;
  if (customAmount !== null && customAmount > 0) {
    if (amountMode === "fixed_plans") {
      throw new ValidationError("Custom amount not allowed for this product");
    }
    if (!customCurrency) throw new ValidationError("Custom currency required");
    snapshot = await quoteFxPrice({
      categorySlug: input.categorySlug,
      foreignAmount: String(customAmount),
      foreignCurrency: customCurrency,
      serviceFeeBps: input.serviceFeeBps,
      fixedAncillaryCostToman: input.fixedAncillaryCostToman,
      allowedCurrencies,
    });
  } else {
    if (amountMode === "custom_amount") {
      throw new ValidationError("Custom amount required");
    }
    snapshot = quoteFixedTomanPrice({
      categorySlug: input.categorySlug,
      unitPriceToman: input.variantPriceToman,
      quantity: input.quantity,
      serviceFeeBps: input.serviceFeeBps,
      fixedAncillaryCostToman: input.fixedAncillaryCostToman,
    });
  }

  return {
    fieldValues,
    snapshot,
    fulfillment: { type: "manual" },
  };
}

async function resolveGift(
  input: CategoryOrderInput,
  config: Record<string, unknown>,
  fieldValues: Record<string, unknown>,
): Promise<CategoryOrderResolution> {
  const denominations = (config.denominations as number[]) ?? [];
  const supportsStars = Boolean(config.supportsStarsQuantity);
  const supportsDuration = Boolean(config.supportsSubscriptionDuration);
  const allowedCurrencies = (config.allowedCurrencies as string[]) ?? ["USD"];

  const denom = asNumber(fieldValues.denomination);
  const stars = asNumber(fieldValues.stars_quantity);
  const duration = asString(fieldValues.subscription_duration);

  if (supportsStars && (stars === null || stars < 1)) {
    throw new ValidationError("Stars quantity required");
  }
  if (!supportsStars && stars !== null) {
    throw new ValidationError("Stars quantity not supported for this product");
  }
  if (supportsDuration && !duration) {
    throw new ValidationError("Subscription duration required");
  }
  if (denom !== null && denominations.length > 0 && !denominations.includes(denom)) {
    throw new ValidationError("Denomination not allowed");
  }

  if (input.pricing.mode === "fx") {
    // Server-bound notional only — never trust client foreignAmount.
    if (denom === null) {
      throw new ValidationError("Denomination required for FX gift pricing");
    }
    const currency =
      input.pricing.foreignCurrency?.toUpperCase() ??
      allowedCurrencies[0]?.toUpperCase() ??
      null;
    if (!currency) throw new ValidationError("FX currency required");
    const qtyFactor = supportsStars && stars ? stars : input.quantity;
    const snapshot = await quoteFxPrice({
      categorySlug: input.categorySlug,
      foreignAmount: d(String(denom)).mul(qtyFactor).toString(),
      foreignCurrency: currency,
      serviceFeeBps: input.serviceFeeBps,
      fixedAncillaryCostToman: input.fixedAncillaryCostToman,
      allowedCurrencies,
    });
    return { fieldValues, snapshot, fulfillment: { type: "manual" } };
  }

  const snapshot = quoteFixedTomanPrice({
    categorySlug: input.categorySlug,
    unitPriceToman: input.variantPriceToman,
    quantity: supportsStars && stars ? stars : input.quantity,
    serviceFeeBps: input.serviceFeeBps,
    fixedAncillaryCostToman: input.fixedAncillaryCostToman,
  });
  return { fieldValues, snapshot, fulfillment: { type: "manual" } };
}

async function resolveAi(
  input: CategoryOrderInput,
  fieldValues: Record<string, unknown>,
): Promise<CategoryOrderResolution> {
  const plan = asString(fieldValues.plan);
  const duration = asString(fieldValues.duration);
  const email = asString(fieldValues.account_email);
  if (!plan) throw new ValidationError("Plan required");
  if (!duration) throw new ValidationError("Duration required");
  if (!email) throw new ValidationError("Account email required");

  // Variant encodes plan/duration price — name should contain both for admin clarity.
  const snapshot = quoteFixedTomanPrice({
    categorySlug: input.categorySlug,
    unitPriceToman: input.variantPriceToman,
    quantity: 1,
    serviceFeeBps: input.serviceFeeBps,
    fixedAncillaryCostToman: input.fixedAncillaryCostToman,
  });
  return {
    fieldValues: {
      ...fieldValues,
      ai_service: input.productTitle,
      catalog_key: input.catalogKey,
      personal_account_only: true,
    },
    snapshot,
    fulfillment: { type: "manual" },
  };
}

async function resolvePaypal(
  input: CategoryOrderInput,
  config: Record<string, unknown>,
  fieldValues: Record<string, unknown>,
): Promise<CategoryOrderResolution> {
  const currencies = ((config.currencies as string[]) ?? []).map((c) => c.toUpperCase());
  const minAmount = config.minAmount as number | undefined;
  const maxAmount = config.maxAmount as number | undefined;
  const feeBps =
    typeof config.feeBps === "number" ? config.feeBps : input.serviceFeeBps;

  const email = asString(fieldValues.paypal_email);
  const amount = asNumber(fieldValues.amount);
  const currency = asString(fieldValues.currency)?.toUpperCase();
  if (!email) throw new ValidationError("PayPal account required");
  if (amount === null || amount <= 0) throw new ValidationError("Amount required");
  if (!currency || !currencies.includes(currency)) {
    throw new ValidationError("Currency not allowed for this PayPal service");
  }
  if (minAmount !== undefined && amount < minAmount) {
    throw new ValidationError("Below PayPal service minimum");
  }
  if (maxAmount !== undefined && amount > maxAmount) {
    throw new ValidationError("Above PayPal service maximum");
  }

  const snapshot = await quoteFxPrice({
    categorySlug: input.categorySlug,
    foreignAmount: String(amount),
    foreignCurrency: currency,
    serviceFeeBps: feeBps,
    fixedAncillaryCostToman: input.fixedAncillaryCostToman,
    allowedCurrencies: currencies,
  });
  return {
    fieldValues: { ...fieldValues, paypal_service: config.service },
    snapshot,
    fulfillment: { type: "manual" },
  };
}

async function resolveShopping(
  input: CategoryOrderInput,
  config: Record<string, unknown>,
  fieldValues: Record<string, unknown>,
): Promise<CategoryOrderResolution> {
  const url = asString(fieldValues.product_url);
  if (!url) throw new ValidationError("Product URL required");
  assertSafeHttpUrl(url);

  const qty = asNumber(fieldValues.quantity) ?? input.quantity;
  if (!Number.isInteger(qty) || qty < 1) throw new ValidationError("Quantity must be >= 1");

  let amount = asNumber(fieldValues.product_price);
  let currency = asString(fieldValues.product_currency)?.toUpperCase();
  let extractionSource: "extracted" | "manual" = "manual";
  let storeKey: string | null = null;

  if (config.extractionEnabled !== false) {
    const extracted = await tryExtractProductPrice(url);
    if (extracted) {
      amount = Number(extracted.amount);
      currency = extracted.currency;
      extractionSource = "extracted";
      storeKey = extracted.storeKey;
      fieldValues.product_price = amount;
      fieldValues.product_currency = currency;
    }
  }

  if (amount === null || amount <= 0 || !currency) {
    if (config.requireManualPriceIfExtractionFails !== false) {
      throw new ValidationError("Manual product price and currency required");
    }
    throw new ValidationError("Unable to determine product price");
  }

  const unitForeign = d(amount).mul(qty).toString();
  const snapshot = await quoteFxPrice({
    categorySlug: input.categorySlug,
    foreignAmount: unitForeign,
    foreignCurrency: currency,
    serviceFeeBps: input.serviceFeeBps,
    // Ancillary once per order, not per item — engine applies fixed once.
    fixedAncillaryCostToman: input.fixedAncillaryCostToman,
    shippingForeign:
      asNumber(fieldValues.shipping_foreign) !== null
        ? String(fieldValues.shipping_foreign)
        : input.pricing.shippingForeign,
    taxForeign:
      asNumber(fieldValues.tax_foreign) !== null
        ? String(fieldValues.tax_foreign)
        : input.pricing.taxForeign,
    customsForeign:
      asNumber(fieldValues.customs_foreign) !== null
        ? String(fieldValues.customs_foreign)
        : input.pricing.customsForeign,
  });

  return {
    fieldValues: {
      ...fieldValues,
      quantity: qty,
      price_source: extractionSource,
      store_key: storeKey,
    },
    snapshot,
    fulfillment: { type: "manual" },
  };
}

async function resolveGame(
  input: CategoryOrderInput,
  config: Record<string, unknown>,
  fieldValues: Record<string, unknown>,
): Promise<CategoryOrderResolution> {
  if (config.requiresPlayerId !== false && !asString(fieldValues.player_id)) {
    throw new ValidationError("Player ID required");
  }
  if (config.requiresServerOrRegion && !asString(fieldValues.server_or_region)) {
    throw new ValidationError("Server or region required");
  }
  // In-app packages: variant Toman only — client FX notional rejected.
  if (input.pricing.mode === "fx") {
    throw new ValidationError("In-app game orders use fixed catalog pricing");
  }
  if (input.variantPriceToman <= 0) {
    throw new ValidationError("Game variant price must be positive");
  }

  const snapshot = quoteFixedTomanPrice({
    categorySlug: input.categorySlug,
    unitPriceToman: input.variantPriceToman,
    quantity: input.quantity,
    serviceFeeBps: input.serviceFeeBps,
    fixedAncillaryCostToman: input.fixedAncillaryCostToman,
  });
  return {
    fieldValues: { ...fieldValues, game_key: config.gameKey, game_name: config.gameName },
    snapshot,
    fulfillment: { type: "manual" },
  };
}

async function resolveCrypto(
  input: CategoryOrderInput,
  config: Record<string, unknown>,
  fieldValues: Record<string, unknown>,
): Promise<CategoryOrderResolution> {
  const supported = ((config.supportedAssets as string[]) ?? []).map((s) => s.toUpperCase());
  const symbol = (
    asString(fieldValues.crypto_symbol) ??
    input.pricing.cryptoSymbol ??
    ""
  ).toUpperCase();
  const amount = asString(fieldValues.crypto_amount) ?? input.pricing.cryptoAmount;
  if (!symbol || !amount) throw new ValidationError("Crypto symbol and amount required");
  if (supported.length > 0 && !supported.includes(symbol)) {
    throw new ValidationError("Asset not supported for this product");
  }
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount) || d(amount).lte(0)) {
    throw new ValidationError("Invalid crypto amount");
  }

  // Prefer trading-engine valuation + shared trade fee when product fee is 0.
  const tradeFeeBps = await getTradeFeeBps();
  const feeBps = input.serviceFeeBps > 0 ? input.serviceFeeBps : tradeFeeBps;
  const market = await quoteCryptoToToman(symbol, amount);
  const { feeToman, payableToman } = applyBuyFee(market.baseToman, feeBps);

  const snapshot = await quoteCryptoPrice({
    categorySlug: input.categorySlug,
    cryptoAmount: amount,
    cryptoSymbol: symbol,
    serviceFeeBps: feeBps,
    fixedAncillaryCostToman: input.fixedAncillaryCostToman,
    allowedAssets: supported.length ? supported : undefined,
  });

  // Align final with trading fee semantics (fee added to payable).
  snapshot.percentageFeeToman = feeToman;
  snapshot.finalToman = payableToman + input.fixedAncillaryCostToman;
  snapshot.baseToman = market.baseToman;
  snapshot.breakdown = {
    ...snapshot.breakdown,
    tradingEngine: true,
    payableToman: snapshot.finalToman,
  };

  return {
    fieldValues: { ...fieldValues, crypto_symbol: symbol, crypto_amount: amount },
    snapshot,
    fulfillment: {
      type: "crypto_reserve",
      cryptoSymbol: symbol,
      cryptoAmount: amount,
    },
  };
}

async function resolveHotelsFlights(
  input: CategoryOrderInput,
  config: Record<string, unknown>,
  fieldValues: Record<string, unknown>,
): Promise<CategoryOrderResolution> {
  const kind = config.kind as string;
  if (kind === "hotel") {
    return resolveHotel(input, config, fieldValues);
  }
  if (kind === "flight") {
    return resolveFlight(input, config, fieldValues);
  }
  throw new ValidationError("Product config kind must be hotel or flight");
}

function resolveHotel(
  input: CategoryOrderInput,
  config: Record<string, unknown>,
  fieldValues: Record<string, unknown>,
): CategoryOrderResolution {
  const city = asString(fieldValues.destination_city);
  const hotel = asString(fieldValues.hotel_name);
  const roomType = asString(fieldValues.room_type);
  const roomCount = asNumber(fieldValues.room_count);
  const adultCount = asNumber(fieldValues.adult_count) ?? 0;
  const childCount = asNumber(fieldValues.child_count) ?? 0;
  if (!city) throw new ValidationError("Destination city required");
  if (!hotel) throw new ValidationError("Selected hotel required");
  if (!roomType) throw new ValidationError("Room type required");
  if (roomCount === null || !Number.isInteger(roomCount) || roomCount < 1) {
    throw new ValidationError("At least one room is required");
  }
  if (adultCount + childCount < 1) {
    throw new ValidationError("At least one guest is required");
  }

  const checkIn = requireDate(fieldValues.check_in, "Check-in date");
  const checkOut = requireDate(fieldValues.check_out, "Check-out date");
  const nights = nightsBetween(checkIn, checkOut);

  const prices = (config.roomNightPrices as Array<{
    roomType: string;
    hotelGrade?: string;
    priceTomanPerNight: number;
  }>) ?? [];
  const match = prices.find(
    (p) => p.roomType === roomType || p.hotelGrade === roomType,
  );
  if (!match) throw new ValidationError("Room type / grade price not configured");

  const total = match.priceTomanPerNight * roomCount * nights;
  const snapshot = quoteFixedTomanPrice({
    categorySlug: input.categorySlug,
    unitPriceToman: total,
    quantity: 1,
    serviceFeeBps: input.serviceFeeBps,
    fixedAncillaryCostToman: input.fixedAncillaryCostToman,
  });
  snapshot.breakdown = {
    ...snapshot.breakdown,
    nights,
    roomCount,
    priceTomanPerNight: match.priceTomanPerNight,
    formula: "roomPricePerNight * rooms * nights",
  };

  return {
    fieldValues: {
      ...fieldValues,
      nights,
      room_count: roomCount,
      priced_room_type: match.roomType,
    },
    snapshot,
    fulfillment: { type: "manual" },
  };
}

function resolveFlight(
  input: CategoryOrderInput,
  config: Record<string, unknown>,
  fieldValues: Record<string, unknown>,
): CategoryOrderResolution {
  const origin = asString(fieldValues.origin);
  const destination = asString(fieldValues.destination);
  const tripType = asString(fieldValues.trip_type);
  const cabin = asString(fieldValues.cabin_class) as "economy" | "business" | "first" | null;
  const adults = asNumber(fieldValues.adult_count);
  const children = asNumber(fieldValues.child_count) ?? 0;

  if (!origin || !destination) throw new ValidationError("Origin and destination required");
  if (!tripType || (tripType !== "one_way" && tripType !== "round_trip")) {
    throw new ValidationError("Trip type must be one_way or round_trip");
  }
  if (!cabin || !["economy", "business", "first"].includes(cabin)) {
    throw new ValidationError("Cabin class required");
  }
  if (adults === null || !Number.isInteger(adults) || adults < 0) {
    throw new ValidationError("Adult count invalid");
  }
  if (!Number.isInteger(children) || children < 0) {
    throw new ValidationError("Child count invalid");
  }
  if (adults + children < 1) throw new ValidationError("At least one passenger is required");

  const departure = requireDate(fieldValues.departure_date, "Departure date");
  const returnRaw = asString(fieldValues.return_date);
  if (tripType === "one_way") {
    if (returnRaw) throw new ValidationError("Return date must be absent for one-way trips");
  } else {
    if (!returnRaw) throw new ValidationError("Return date required for round-trip");
    const ret = requireDate(returnRaw, "Return date");
    if (ret.getTime() <= departure.getTime()) {
      throw new ValidationError("Return date must be after departure");
    }
  }

  const routes = (config.routes as Array<{
    origin: string;
    destination: string;
    adultBasePriceToman: number;
  }>) ?? [];
  const route = routes.find(
    (r) =>
      r.origin.toLowerCase() === origin.toLowerCase() &&
      r.destination.toLowerCase() === destination.toLowerCase(),
  );
  if (!route) throw new ValidationError("Route price not configured");

  const childRatio = typeof config.childRatio === "number" ? config.childRatio : 0.75;
  const multipliers = (config.cabinMultipliers as Record<string, number>) ?? {
    economy: 1,
    business: 1.8,
    first: 2.5,
  };
  const cabinMult = multipliers[cabin] ?? 1;
  const roundTripMult =
    tripType === "round_trip"
      ? typeof config.roundTripMultiplier === "number"
        ? config.roundTripMultiplier
        : 1.85
      : 1;

  const adultPart = adults * route.adultBasePriceToman;
  const childPart = children * route.adultBasePriceToman * childRatio;
  const total = toTomanInt(d(adultPart + childPart).mul(cabinMult).mul(roundTripMult));

  const snapshot = quoteFixedTomanPrice({
    categorySlug: input.categorySlug,
    unitPriceToman: total,
    quantity: 1,
    serviceFeeBps: input.serviceFeeBps,
    fixedAncillaryCostToman: input.fixedAncillaryCostToman,
  });
  snapshot.breakdown = {
    ...snapshot.breakdown,
    formula: "adults*base + children*base*childRatio, then cabin and trip multipliers",
    adultBasePriceToman: route.adultBasePriceToman,
    childRatio,
    cabinMult,
    roundTripMult,
  };

  return {
    fieldValues: {
      ...fieldValues,
      origin,
      destination,
      trip_type: tripType,
      cabin_class: cabin,
      adult_count: adults,
      child_count: children,
    },
    snapshot,
    fulfillment: { type: "manual" },
  };
}
