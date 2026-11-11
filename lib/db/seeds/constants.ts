/**
 * Canonical seed values for baseline data.
 * Applied by a later seed script / migration — not auto-run on import.
 */

export const ROLE_SEEDS = [
  {
    slug: "customer",
    name: "Customer",
    description: "Default role for new registrations",
  },
  {
    slug: "admin",
    name: "Admin",
    description: "Administrative operator; cannot grant super_admin",
  },
  {
    slug: "super_admin",
    name: "Super Admin",
    description: "Full platform control including admin management",
  },
] as const;

export const CATEGORY_SEEDS = [
  { slug: "visa-mastercard", name: "Visa and Mastercard", sortOrder: 1 },
  {
    slug: "gift-cards-premium",
    name: "Gift Cards and Premium Digital Products",
    sortOrder: 2,
  },
  { slug: "ai-subscriptions", name: "AI Subscriptions", sortOrder: 3 },
  { slug: "cryptocurrency", name: "Cryptocurrency", sortOrder: 4 },
  { slug: "paypal-services", name: "PayPal Services", sortOrder: 5 },
  { slug: "international-shopping", name: "International Shopping", sortOrder: 6 },
  { slug: "in-app-game-purchases", name: "In-App Game Purchases", sortOrder: 7 },
  {
    slug: "international-hotels-flights",
    name: "International Hotels and Flights",
    sortOrder: 8,
  },
] as const;

export const CURRENCY_SEEDS = [
  { code: "IRT", name: "Iranian Toman", kind: "fiat" as const, decimals: 0 },
  { code: "USD", name: "US Dollar", kind: "fiat" as const, decimals: 2 },
  { code: "EUR", name: "Euro", kind: "fiat" as const, decimals: 2 },
  { code: "USDT", name: "Tether USD", kind: "crypto" as const, decimals: 6 },
  { code: "BTC", name: "Bitcoin", kind: "crypto" as const, decimals: 8 },
  { code: "ETH", name: "Ethereum", kind: "crypto" as const, decimals: 18 },
] as const;
