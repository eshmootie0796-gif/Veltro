import { eq } from "drizzle-orm";
import { seedBaseline } from "../lib/db/seeds/run";
import { db } from "../lib/db";
import { cryptoWallets, fiatWallets, roles, users } from "../lib/db/schema";
import { newId } from "../lib/ids";
import { hashPassword } from "../lib/auth/password";
import type { AuthUser } from "../lib/auth/rbac";
import { createProduct } from "../lib/services/catalog/products";
import { createVariant } from "../lib/services/catalog/variants";
import { replaceFields } from "../lib/services/catalog/fields";
import { createOrder } from "../lib/services/orders/create";
import { resolveCategoryOrder } from "../lib/services/orders/categories/resolve";
import { assertSafeHttpUrl } from "../lib/services/shopping/ssrf";
import { refreshMarketRates } from "../lib/pricing/refresh";
import type { RateProvider } from "../lib/pricing/providers/types";
import { getCryptoWallet } from "../lib/services/crypto/wallet";
import { adminIncreaseReserve } from "../lib/services/crypto/reserve";
import { ValidationError } from "../lib/errors";
import { d } from "../lib/money/decimal";
import { defaultFieldsForCategory } from "../lib/catalog/category-configs";
import { CATEGORY_SLUGS } from "../lib/catalog/constants";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const mockFx: RateProvider = {
  key: "exchange_rate",
  name: "mock_fx",
  async fetchRates(bases, quote) {
    return bases.map((base) => ({
      baseCode: base.toUpperCase(),
      quoteCode: quote.toUpperCase(),
      rate: base.toUpperCase() === "USD" ? "60000" : base.toUpperCase() === "EUR" ? "65000" : "1",
      marketTimestamp: new Date(),
      providerName: "mock_fx",
    }));
  },
};

const mockCrypto: RateProvider = {
  key: "crypto_price",
  name: "mock_crypto",
  async fetchRates(bases, quote) {
    return bases.map((base) => ({
      baseCode: base.toUpperCase(),
      quoteCode: quote.toUpperCase(),
      rate: base.toUpperCase() === "BTC" ? "65000" : base.toUpperCase() === "ETH" ? "3500" : "1",
      marketTimestamp: new Date(),
      providerName: "mock_crypto",
    }));
  },
};

async function makeUser(roleSlug: "customer" | "admin"): Promise<AuthUser> {
  const role = await db.query.roles.findFirst({ where: eq(roles.slug, roleSlug) });
  assert(role, "role");
  const id = newId();
  const suffix = id.slice(0, 8);
  await db.insert(users).values({
    id,
    username: `${roleSlug}_${suffix}`,
    email: `${roleSlug}_${suffix}@test.local`,
    firstName: "Cat",
    lastName: "Test",
    name: "Cat Test",
    passwordHash: await hashPassword("TestPass123!"),
    roleId: role.id,
    status: "active",
    emailVerified: new Date(),
  });
  await db.insert(fiatWallets).values({ id: newId(), userId: id, balanceToman: 0 });
  await db.insert(cryptoWallets).values({ id: newId(), userId: id });
  return {
    id,
    email: `${roleSlug}_${suffix}@test.local`,
    username: `${roleSlug}_${suffix}`,
    role: roleSlug,
    status: "active",
    emailVerified: new Date(),
    sessionVersion: 0,
  };
}

async function main() {
  await seedBaseline();
  await refreshMarketRates({
    fxProvider: mockFx,
    cryptoProvider: mockCrypto,
    fxBases: ["USD", "EUR"],
    cryptoBases: ["BTC", "ETH", "USDT"],
  });

  const admin = await makeUser("admin");
  const customer = await makeUser("customer");

  // SSRF blocks
  let blockedLocal = false;
  try {
    assertSafeHttpUrl("http://127.0.0.1/admin");
  } catch (error) {
    blockedLocal = error instanceof ValidationError;
  }
  assert(blockedLocal, "localhost blocked");
  let blockedScheme = false;
  try {
    assertSafeHttpUrl("file:///etc/passwd");
  } catch (error) {
    blockedScheme = error instanceof ValidationError;
  }
  assert(blockedScheme, "file scheme blocked");

  // Hotel pricing
  const hotel = await resolveCategoryOrder({
    categorySlug: CATEGORY_SLUGS.hotelsFlights,
    productTitle: "Hotel X",
    catalogKey: null,
    config: {
      kind: "hotel",
      roomNightPrices: [{ roomType: "deluxe", priceTomanPerNight: 2_000_000 }],
    },
    variantName: "Deluxe",
    variantPriceToman: 0,
    serviceFeeBps: 0,
    fixedAncillaryCostToman: 1000,
    minOrderAmountToman: null,
    maxOrderAmountToman: null,
    quantity: 1,
    fieldValues: {
      destination_city: "Istanbul",
      hotel_name: "Pera Palace",
      check_in: "2026-12-01",
      check_out: "2026-12-04",
      room_count: 2,
      adult_count: 2,
      child_count: 0,
      room_type: "deluxe",
    },
    pricing: { mode: "fixed_irt" },
  });
  // 2e6 * 2 rooms * 3 nights = 12e6 + fixed 1000
  assert(hotel.snapshot.baseToman === 12_000_000, `hotel base ${hotel.snapshot.baseToman}`);
  assert(hotel.snapshot.finalToman === 12_001_000, `hotel final ${hotel.snapshot.finalToman}`);

  let badCheckout = false;
  try {
    await resolveCategoryOrder({
      categorySlug: CATEGORY_SLUGS.hotelsFlights,
      productTitle: "Hotel X",
      catalogKey: null,
      config: {
        kind: "hotel",
        roomNightPrices: [{ roomType: "deluxe", priceTomanPerNight: 2_000_000 }],
      },
      variantName: "Deluxe",
      variantPriceToman: 0,
      serviceFeeBps: 0,
      fixedAncillaryCostToman: 0,
      minOrderAmountToman: null,
      maxOrderAmountToman: null,
      quantity: 1,
      fieldValues: {
        destination_city: "Istanbul",
        hotel_name: "Pera",
        check_in: "2026-12-04",
        check_out: "2026-12-01",
        room_count: 1,
        adult_count: 1,
        room_type: "deluxe",
      },
      pricing: { mode: "fixed_irt" },
    });
  } catch (error) {
    badCheckout = error instanceof ValidationError;
  }
  assert(badCheckout, "checkout before checkin rejected");

  // Flight pricing
  const flight = await resolveCategoryOrder({
    categorySlug: CATEGORY_SLUGS.hotelsFlights,
    productTitle: "Flight",
    catalogKey: null,
    config: {
      kind: "flight",
      routes: [{ origin: "THR", destination: "IST", adultBasePriceToman: 10_000_000 }],
      childRatio: 0.5,
      cabinMultipliers: { economy: 1, business: 2, first: 3 },
      roundTripMultiplier: 2,
    },
    variantName: "Route",
    variantPriceToman: 0,
    serviceFeeBps: 0,
    fixedAncillaryCostToman: 0,
    minOrderAmountToman: null,
    maxOrderAmountToman: null,
    quantity: 1,
    fieldValues: {
      origin: "THR",
      destination: "IST",
      departure_date: "2026-12-10",
      return_date: "2026-12-20",
      adult_count: 2,
      child_count: 2,
      cabin_class: "business",
      trip_type: "round_trip",
    },
    pricing: { mode: "fixed_irt" },
  });
  // adults 2*10m=20m; children 2*10m*0.5=10m; subtotal 30m; *2 cabin *2 round = 120m
  assert(flight.snapshot.baseToman === 120_000_000, `flight base ${flight.snapshot.baseToman}`);

  let oneWayReturn = false;
  try {
    await resolveCategoryOrder({
      categorySlug: CATEGORY_SLUGS.hotelsFlights,
      productTitle: "Flight",
      catalogKey: null,
      config: {
        kind: "flight",
        routes: [{ origin: "THR", destination: "IST", adultBasePriceToman: 10_000_000 }],
      },
      variantName: "Route",
      variantPriceToman: 0,
      serviceFeeBps: 0,
      fixedAncillaryCostToman: 0,
      minOrderAmountToman: null,
      maxOrderAmountToman: null,
      quantity: 1,
      fieldValues: {
        origin: "THR",
        destination: "IST",
        departure_date: "2026-12-10",
        return_date: "2026-12-20",
        adult_count: 1,
        cabin_class: "economy",
        trip_type: "one_way",
      },
      pricing: { mode: "fixed_irt" },
    });
  } catch (error) {
    oneWayReturn = error instanceof ValidationError;
  }
  assert(oneWayReturn, "one-way cannot have return date");

  // AI rejects password
  let aiPassword = false;
  try {
    await resolveCategoryOrder({
      categorySlug: CATEGORY_SLUGS.aiSubscriptions,
      productTitle: "ChatGPT",
      catalogKey: "ai.chatgpt",
      config: {
        group: "assistants",
        personalAccountOnly: true,
        neverCollectPassword: true,
        noSharedAccounts: true,
      },
      variantName: "Plus 1m",
      variantPriceToman: 5_000_000,
      serviceFeeBps: 0,
      fixedAncillaryCostToman: 0,
      minOrderAmountToman: null,
      maxOrderAmountToman: null,
      quantity: 1,
      fieldValues: {
        plan: "Plus",
        duration: "1 month",
        account_email: "a@b.com",
        password: "secret",
      },
      pricing: { mode: "fixed_irt" },
    });
  } catch (error) {
    aiPassword = error instanceof ValidationError;
  }
  assert(aiPassword, "AI password rejected");

  // Visa product order
  const visaProduct = await createProduct(admin, {
    categorySlug: CATEGORY_SLUGS.visaMastercard,
    title: "Visa Virtual",
    slug: `visa-${newId().slice(0, 6)}`,
    serviceFeeBps: 200,
    fixedAncillaryCostToman: 5000,
    config: {
      cardBrands: ["visa", "mastercard"],
      formFactors: ["physical", "virtual"],
      cardTypes: ["prepaid", "debit", "credit"],
      issuingCountries: ["TR", "AE"],
      amountMode: "both",
      allowedCurrencies: ["USD"],
    },
  });
  await replaceFields(
    admin,
    visaProduct.id,
    defaultFieldsForCategory(CATEGORY_SLUGS.visaMastercard),
  );
  const visaVariant = await createVariant(admin, visaProduct.id, {
    name: "Plan 100",
    priceToman: 7_000_000,
    capacityMode: "unlimited",
  });
  const visaOrder = await createOrder(customer, {
    variantId: visaVariant.id,
    quantity: 1,
    fieldValues: {
      card_brand: "visa",
      form_factor: "virtual",
      card_type: "prepaid",
      issuing_country: "TR",
      custom_amount: 50,
      custom_currency: "USD",
    },
    pricing: { mode: "fx" },
  });
  // 50*60000=3e6; fee 2%=60_000; fixed 5000 => 3_065_000
  assert(visaOrder.payableToman === 3_065_000, `visa payable ${visaOrder.payableToman}`);

  // Shopping requires manual price when extraction fails (localhost URL fails extract)
  const shop = await createProduct(admin, {
    categorySlug: CATEGORY_SLUGS.internationalShopping,
    title: "Shop Assist",
    slug: `shop-${newId().slice(0, 6)}`,
    serviceFeeBps: 100,
    fixedAncillaryCostToman: 2000,
    config: {
      stores: [],
      extractionEnabled: true,
      requireManualPriceIfExtractionFails: true,
    },
  });
  await replaceFields(
    admin,
    shop.id,
    defaultFieldsForCategory(CATEGORY_SLUGS.internationalShopping),
  );
  const shopVariant = await createVariant(admin, shop.id, {
    name: "Default",
    priceToman: 0,
    capacityMode: "unlimited",
  });
  let shopNeedsManual = false;
  try {
    await createOrder(customer, {
      variantId: shopVariant.id,
      quantity: 1,
      fieldValues: {
        product_url: "https://example.com/item/1",
        quantity: 2,
      },
      pricing: { mode: "fx" },
    });
  } catch (error) {
    shopNeedsManual = error instanceof ValidationError;
  }
  assert(shopNeedsManual, "shopping needs manual price");

  const shopOrder = await createOrder(customer, {
    variantId: shopVariant.id,
    quantity: 1,
    fieldValues: {
      product_url: "https://example.com/item/1",
      product_price: 20,
      product_currency: "USD",
      shipping_foreign: 5,
      tax_foreign: 1,
      customs_foreign: 1,
      quantity: 2,
    },
    pricing: { mode: "fx" },
  });
  // product 40*60000=2.4e6; ship/tax/customs 7*60000=420k; base 2.82e6; fee 1%=28200; fixed 2000
  assert(shopOrder.payableToman === 2_850_200, `shop payable ${shopOrder.payableToman}`);

  // Crypto order uses trading engine + credits reserve balance on pay
  const cryptoProduct = await createProduct(admin, {
    categorySlug: CATEGORY_SLUGS.cryptocurrency,
    title: "BTC Desk",
    slug: `btc-${newId().slice(0, 6)}`,
    serviceFeeBps: 0,
    config: {
      supportedAssets: ["BTC", "ETH"],
      useInternalTradingEngine: true,
    },
  });
  await replaceFields(admin, cryptoProduct.id, defaultFieldsForCategory(CATEGORY_SLUGS.cryptocurrency));
  const cryptoVariant = await createVariant(admin, cryptoProduct.id, {
    name: "Spot",
    priceToman: 0,
    capacityMode: "unlimited",
  });
  await adminIncreaseReserve(admin, {
    currencyCode: "BTC",
    amount: "1",
    reason: "category test",
  });
  await db
    .update(fiatWallets)
    .set({ balanceToman: 100_000_000_000, updatedAt: new Date() })
    .where(eq(fiatWallets.userId, customer.id));

  const cryptoOrder = await createOrder(customer, {
    variantId: cryptoVariant.id,
    fieldValues: { crypto_symbol: "BTC", crypto_amount: "0.001" },
    pricing: { mode: "crypto", cryptoSymbol: "BTC", cryptoAmount: "0.001" },
  });
  assert(
    (cryptoOrder.pricingSnapshot as { fulfillment?: { type?: string } }).fulfillment?.type ===
      "crypto_reserve",
    "crypto fulfillment tagged",
  );

  // Pay via markOrderPaid (simulates successful payment path)
  const { payOrder } = await import("../lib/services/payments/service");
  const { PAYMENT_METHODS } = await import("../lib/payments/constants");
  // Use mock gateway success so we don't need exact wallet debit math for large amounts
  await payOrder(customer, cryptoOrder.id, {
    method: PAYMENT_METHODS.simulatedGateway,
    simulate: "success",
  });
  const cw = await getCryptoWallet(customer);
  const btc = cw.balances.find((b) => b.currencyCode === "BTC");
  assert(btc && d(btc.balance).eq("0.001"), `btc credited ${btc?.balance}`);

  // PayPal min/max (locked catalog — resolve path)
  let ppMin = false;
  try {
    await resolveCategoryOrder({
      categorySlug: CATEGORY_SLUGS.paypalServices,
      productTitle: "Send",
      catalogKey: "paypal.send-money",
      config: {
        service: "send-money",
        currencies: ["USD"],
        minAmount: 10,
        maxAmount: 500,
        feeBps: 150,
      },
      variantName: "Send",
      variantPriceToman: 0,
      serviceFeeBps: 150,
      fixedAncillaryCostToman: 0,
      minOrderAmountToman: null,
      maxOrderAmountToman: null,
      quantity: 1,
      fieldValues: { paypal_email: "a@b.com", amount: 5, currency: "USD" },
      pricing: { mode: "fx" },
    });
  } catch (error) {
    ppMin = error instanceof ValidationError;
  }
  assert(ppMin, "paypal min enforced");

  const ppOk = await resolveCategoryOrder({
    categorySlug: CATEGORY_SLUGS.paypalServices,
    productTitle: "Send",
    catalogKey: "paypal.send-money",
    config: {
      service: "send-money",
      currencies: ["USD"],
      minAmount: 10,
      maxAmount: 500,
      feeBps: 150,
    },
    variantName: "Send",
    variantPriceToman: 0,
    serviceFeeBps: 150,
    fixedAncillaryCostToman: 0,
    minOrderAmountToman: null,
    maxOrderAmountToman: null,
    quantity: 1,
    fieldValues: { paypal_email: "a@b.com", amount: 100, currency: "USD" },
    pricing: { mode: "fx" },
  });
  // 100*60000=6e6; fee 1.5%=90_000 => 6_090_000
  assert(ppOk.snapshot.finalToman === 6_090_000, `paypal final ${ppOk.snapshot.finalToman}`);

  console.log(
    JSON.stringify({
      ok: true,
      suite: "test-categories",
      hotelFinal: hotel.snapshot.finalToman,
      flightBase: flight.snapshot.baseToman,
      visaPayable: visaOrder.payableToman,
      shopPayable: shopOrder.payableToman,
      cryptoPayable: cryptoOrder.payableToman,
    }),
  );
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
