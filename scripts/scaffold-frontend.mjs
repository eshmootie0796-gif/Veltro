import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function write(rel, contents) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  if (fs.existsSync(full) && fs.statSync(full).size > 0) return false;
  fs.writeFileSync(full, contents, "utf8");
  return true;
}

function page(name) {
  return `export default function ${name}() {\n  return null;\n}\n`;
}

function layout(name) {
  return `export default function ${name}({\n  children,\n}: {\n  children: React.ReactNode;\n}) {\n  return children;\n}\n`;
}

function component(name) {
  return `export function ${name}() {\n  return null;\n}\n`;
}

function barrel() {
  return `export {};\n`;
}

function pascalFromKebab(name) {
  return name
    .split("-")
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join("");
}

// Fix typo route group if present
const typo = path.join(root, "app", "(costumer)");
if (fs.existsSync(typo)) {
  fs.rmSync(typo, { recursive: true, force: true });
}

const files = [];

const routePages = [
  ["app/(auth)/login/page.tsx", "LoginPage"],
  ["app/(auth)/register/page.tsx", "RegisterPage"],
  ["app/(auth)/verify-email/page.tsx", "VerifyEmailPage"],
  ["app/(auth)/forgot-password/page.tsx", "ForgotPasswordPage"],
  ["app/(auth)/reset-password/page.tsx", "ResetPasswordPage"],
  ["app/(store)/layout.tsx", null],
  ["app/(store)/services/page.tsx", "ServicesPage"],
  ["app/(store)/services/[category]/page.tsx", "ServiceCategoryPage"],
  ["app/(store)/services/[category]/[slug]/page.tsx", "ServiceDetailPage"],
  ["app/(store)/discounts/page.tsx", "DiscountsPage"],
  ["app/(store)/about/page.tsx", "AboutPage"],
  ["app/(store)/terms/page.tsx", "TermsPage"],
  ["app/(customer)/account/layout.tsx", null],
  ["app/(customer)/account/page.tsx", "AccountPage"],
  ["app/(customer)/account/orders/page.tsx", "AccountOrdersPage"],
  ["app/(customer)/account/orders/[orderId]/page.tsx", "AccountOrderDetailPage"],
  ["app/(customer)/account/transactions/page.tsx", "AccountTransactionsPage"],
  ["app/(customer)/account/wallet/page.tsx", "AccountWalletPage"],
  ["app/(customer)/account/wallet/history/page.tsx", "AccountWalletHistoryPage"],
  ["app/(customer)/account/crypto/page.tsx", "AccountCryptoPage"],
  ["app/(customer)/account/crypto/buy/page.tsx", "AccountCryptoBuyPage"],
  ["app/(customer)/account/crypto/sell/page.tsx", "AccountCryptoSellPage"],
  ["app/(customer)/account/crypto/convert/page.tsx", "AccountCryptoConvertPage"],
  ["app/(customer)/account/notifications/page.tsx", "AccountNotificationsPage"],
  ["app/(customer)/account/reviews/page.tsx", "AccountReviewsPage"],
  ["app/(customer)/account/settings/page.tsx", "AccountSettingsPage"],
  ["app/(checkout)/checkout/[orderId]/page.tsx", "CheckoutPage"],
  ["app/(admin)/admin/layout.tsx", null],
  ["app/(admin)/admin/page.tsx", "AdminDashboardPage"],
  ["app/(admin)/admin/orders/page.tsx", "AdminOrdersPage"],
  ["app/(admin)/admin/orders/[orderId]/page.tsx", "AdminOrderDetailPage"],
  ["app/(admin)/admin/products/page.tsx", "AdminProductsPage"],
  ["app/(admin)/admin/products/new/page.tsx", "AdminProductNewPage"],
  ["app/(admin)/admin/products/[productId]/page.tsx", "AdminProductDetailPage"],
  ["app/(admin)/admin/categories/page.tsx", "AdminCategoriesPage"],
  ["app/(admin)/admin/customers/page.tsx", "AdminCustomersPage"],
  ["app/(admin)/admin/customers/[userId]/page.tsx", "AdminCustomerDetailPage"],
  ["app/(admin)/admin/transactions/page.tsx", "AdminTransactionsPage"],
  ["app/(admin)/admin/discounts/page.tsx", "AdminDiscountsPage"],
  ["app/(admin)/admin/reviews/page.tsx", "AdminReviewsPage"],
  ["app/(admin)/admin/reports/page.tsx", "AdminReportsPage"],
  ["app/(admin)/admin/rates/page.tsx", "AdminRatesPage"],
  ["app/(admin)/admin/crypto-reserve/page.tsx", "AdminCryptoReservePage"],
  ["app/(admin)/admin/notifications/page.tsx", "AdminNotificationsPage"],
  ["app/(admin)/admin/admins/page.tsx", "AdminAdminsPage"],
  ["app/(admin)/admin/settings/page.tsx", "AdminSettingsPage"],
  ["app/(admin)/admin/audit-logs/page.tsx", "AdminAuditLogsPage"],
];

for (const [rel, name] of routePages) {
  files.push([rel, name ? page(name) : layout(rel.includes("admin") ? "AdminLayout" : rel.includes("account") ? "AccountLayout" : "StoreLayout")]);
}

const ui = ["button", "input", "select", "dialog", "dropdown-menu", "table", "badge", "card", "skeleton"];
for (const name of ui) files.push([`components/ui/${name}.tsx`, component(pascalFromKebab(name))]);

for (const name of ["Header", "Footer", "MainNavigation", "MobileNavigation", "PageContainer", "ThemeProvider"]) {
  files.push([`components/layout/${name}.tsx`, component(name)]);
}

for (const name of [
  "Logo",
  "PageHeader",
  "SearchInput",
  "EmptyState",
  "ErrorState",
  "ConfirmDialog",
  "PriceDisplay",
  "CurrencyDisplay",
  "StatusBadge",
  "DataTable",
]) {
  files.push([`components/shared/${name}.tsx`, component(name)]);
}

for (const name of ["LoginForm", "RegisterForm", "VerifyEmailForm", "ResetPasswordForm"]) {
  files.push([`components/auth/${name}.tsx`, component(name)]);
}

for (const name of [
  "HeroSection",
  "CategoryGrid",
  "CategoryCard",
  "FeaturedServices",
  "ServiceCard",
  "ServiceFilters",
  "DiscountBanner",
]) {
  files.push([`components/store/${name}.tsx`, component(name)]);
}

for (const name of [
  "ServiceDetails",
  "ServiceOptions",
  "DynamicOrderForm",
  "OrderSummary",
  "PriceBreakdown",
  "ServiceAvailability",
]) {
  files.push([`components/services/${name}.tsx`, component(name)]);
}

for (const name of [
  "CheckoutSummary",
  "PaymentMethodSelector",
  "WalletPayment",
  "MockGatewayPayment",
  "PaymentResult",
]) {
  files.push([`components/checkout/${name}.tsx`, component(name)]);
}

for (const name of [
  "AccountSidebar",
  "AccountHeader",
  "AccountOverview",
  "OrderList",
  "OrderDetails",
  "TransactionList",
  "NotificationList",
  "ProfileForm",
]) {
  files.push([`components/account/${name}.tsx`, component(name)]);
}

for (const name of ["WalletBalance", "WalletTopUpForm", "WalletHistory", "WalletTransaction"]) {
  files.push([`components/wallet/${name}.tsx`, component(name)]);
}

for (const name of [
  "CryptoBalance",
  "CryptoAssetList",
  "CryptoTradeForm",
  "CryptoConverter",
  "CryptoPriceCard",
]) {
  files.push([`components/crypto/${name}.tsx`, component(name)]);
}

const admin = [
  ["layout/AdminSidebar", "AdminSidebar"],
  ["layout/AdminHeader", "AdminHeader"],
  ["layout/AdminNavigation", "AdminNavigation"],
  ["dashboard/StatsGrid", "StatsGrid"],
  ["dashboard/SalesChart", "SalesChart"],
  ["dashboard/RecentOrders", "RecentOrders"],
  ["dashboard/PopularServices", "PopularServices"],
  ["orders/OrdersTable", "OrdersTable"],
  ["orders/OrderStatusActions", "OrderStatusActions"],
  ["orders/OrderReviewPanel", "OrderReviewPanel"],
  ["products/ProductTable", "ProductTable"],
  ["products/ProductForm", "ProductForm"],
  ["products/ProductOptionsEditor", "ProductOptionsEditor"],
  ["products/DynamicFieldsEditor", "DynamicFieldsEditor"],
  ["customers/CustomersTable", "CustomersTable"],
  ["customers/CustomerDetails", "CustomerDetails"],
  ["discounts/DiscountTable", "DiscountTable"],
  ["discounts/DiscountForm", "DiscountForm"],
  ["reviews/ReviewModeration", "ReviewModeration"],
  ["settings/GeneralSettingsForm", "GeneralSettingsForm"],
];
for (const [rel, name] of admin) files.push([`components/admin/${rel}.tsx`, component(name)]);

const categoryForms = [
  ["visa-mastercard/VisaMastercardForm", "VisaMastercardForm"],
  ["gift-cards/GiftCardForm", "GiftCardForm"],
  ["ai-subscriptions/AISubscriptionForm", "AISubscriptionForm"],
  ["cryptocurrency/CryptoOrderForm", "CryptoOrderForm"],
  ["paypal/PayPalForm", "PayPalForm"],
  ["international-shopping/ShoppingOrderForm", "ShoppingOrderForm"],
  ["game-purchases/GamePurchaseForm", "GamePurchaseForm"],
  ["hotels-flights/HotelBookingForm", "HotelBookingForm"],
  ["hotels-flights/FlightBookingForm", "FlightBookingForm"],
];
for (const [rel, name] of categoryForms) {
  files.push([`components/category-forms/${rel}.tsx`, component(name)]);
}

const featureSpecs = [
  ["auth", ["api", "hooks", "schemas", "types"]],
  ["products", ["api", "hooks", "schemas", "types"]],
  ["orders", ["api", "hooks", "schemas", "types"]],
  ["payments", ["api", "hooks", "types"]],
  ["wallet", ["api", "hooks", "types"]],
  ["crypto", ["api", "hooks", "types"]],
  ["discounts", ["api", "hooks"]],
  ["notifications", ["api", "hooks"]],
  ["reviews", ["api", "hooks"]],
  ["admin", ["api", "hooks"]],
];
for (const [feature, parts] of featureSpecs) {
  for (const part of parts) files.push([`features/${feature}/${part}/index.ts`, barrel()]);
}

files.push(
  ["hooks/useDebounce.ts", "export function useDebounce<T>(value: T, _ms = 300): T {\n  return value;\n}\n"],
  ["hooks/useMediaQuery.ts", "export function useMediaQuery(_query: string): boolean {\n  return false;\n}\n"],
  ["hooks/useMounted.ts", "export function useMounted(): boolean {\n  return true;\n}\n"],
  ["stores/ui.store.ts", "export const uiStore = {\n  sidebarOpen: false,\n};\n"],
  ['stores/theme.store.ts', 'export const themeStore = {\n  theme: "system" as const,\n};\n'],
  ['stores/preferences.store.ts', 'export const preferencesStore = {\n  locale: "fa",\n};\n'],
  [
    "lib/api-client.ts",
    'export async function apiClient<T>(_path: string, _init?: RequestInit): Promise<T> {\n  throw new Error("apiClient not implemented");\n}\n',
  ],
  [
    "lib/query-client.ts",
    'export function getQueryClient() {\n  throw new Error("query-client not implemented");\n}\n',
  ],
  [
    "lib/auth-client.ts",
    'export const authClient = {\n  signIn() {\n    throw new Error("auth-client not implemented");\n  },\n};\n',
  ],
  [
    "lib/utils.ts",
    "export function cn(...parts: Array<string | false | null | undefined>): string {\n  return parts.filter(Boolean).join(\" \");\n}\n",
  ],
  [
    "lib/formatters.ts",
    'export function formatToman(amount: number): string {\n  return new Intl.NumberFormat("fa-IR").format(amount);\n}\n',
  ],
  ['lib/constants.ts', 'export const APP_NAME = "Nexora";\n'],
  ["lib/validations.ts", barrel()],
  ["config/navigation.ts", "export const storeNav = [] as const;\n"],
  ["config/categories.ts", "export const categorySlugs = [] as const;\n"],
  ["config/permissions.ts", "export const permissions = {} as const;\n"],
  [
    "config/site.ts",
    'export const siteConfig = {\n  name: "Nexora",\n  description: "Digital services marketplace",\n} as const;\n',
  ],
  ["types/api.ts", "export type ApiSuccess<T> = { ok: true; data: T };\n"],
  ["types/common.ts", "export type Id = string;\n"],
  ['types/user.ts', 'export type UserRole = "customer" | "admin" | "super_admin";\n'],
  ["types/product.ts", "export type ProductSummary = { id: string; slug: string; name: string };\n"],
  ["types/order.ts", "export type OrderSummary = { id: string; status: string };\n"],
  ['types/payment.ts', 'export type PaymentMethod = "wallet" | "mock_gateway";\n'],
  ["types/wallet.ts", "export type WalletBalance = { balanceToman: number };\n"],
  [
    "providers/QueryProvider.tsx",
    "export function QueryProvider({ children }: { children: React.ReactNode }) {\n  return children;\n}\n",
  ],
  [
    "providers/AuthProvider.tsx",
    "export function AuthProvider({ children }: { children: React.ReactNode }) {\n  return children;\n}\n",
  ],
  [
    "providers/ThemeProvider.tsx",
    "export function ThemeProvider({ children }: { children: React.ReactNode }) {\n  return children;\n}\n",
  ],
  [
    "providers/AppProviders.tsx",
    'import { AuthProvider } from "@/providers/AuthProvider";\nimport { QueryProvider } from "@/providers/QueryProvider";\nimport { ThemeProvider } from "@/providers/ThemeProvider";\n\nexport function AppProviders({ children }: { children: React.ReactNode }) {\n  return (\n    <ThemeProvider>\n      <QueryProvider>\n        <AuthProvider>{children}</AuthProvider>\n      </QueryProvider>\n    </ThemeProvider>\n  );\n}\n',
  ],
  [
    "components.json",
    `${JSON.stringify(
      {
        $schema: "https://ui.shadcn.com/schema.json",
        style: "new-york",
        rsc: true,
        tsx: true,
        tailwind: {
          config: "",
          css: "app/globals.css",
          baseColor: "neutral",
          cssVariables: true,
        },
        aliases: {
          components: "@/components",
          utils: "@/lib/utils",
          ui: "@/components/ui",
          lib: "@/lib",
          hooks: "@/hooks",
        },
      },
      null,
      2,
    )}\n`,
  ],
);

for (const dir of [
  "public/images/logo",
  "public/images/banners",
  "public/images/categories",
  "public/images/placeholders",
  "public/icons",
  "public/fonts",
]) {
  files.push([`${dir}/.gitkeep`, ""]);
}

let created = 0;
let skipped = 0;
for (const [rel, contents] of files) {
  if (write(rel, contents)) created += 1;
  else skipped += 1;
}

console.log(JSON.stringify({ ok: true, created, skipped, total: files.length }));
