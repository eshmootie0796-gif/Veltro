import { and, count, desc, eq, gte, inArray, sql, sum } from "drizzle-orm";
import { db } from "../../db";
import {
  fiatWallets,
  orderItems,
  orders,
  payments,
  products,
  roles,
  users,
} from "../../db/schema";
import type { AuthUser } from "../../auth/rbac";
import { assertAdmin } from "../../auth/rbac";
import { ORDER_STATUSES } from "../../orders/constants";
import { PAYMENT_STATUSES } from "../../payments/constants";

function startOfDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function getAdminReports(actor: AuthUser) {
  assertAdmin(actor);
  const now = new Date();
  const dayStart = startOfDay(now);
  const weekStart = new Date(dayStart);
  weekStart.setUTCDate(weekStart.getUTCDate() - 6);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const orderStatusRows = await db
    .select({ status: orders.status, value: count() })
    .from(orders)
    .groupBy(orders.status);

  const soldStatuses = [
    ORDER_STATUSES.paid,
    ORDER_STATUSES.pendingAdminReview,
    ORDER_STATUSES.processing,
    ORDER_STATUSES.completed,
    ORDER_STATUSES.cancellationRequested,
  ];
  const revenuePaid = await db
    .select({ value: sum(orders.payableToman) })
    .from(orders)
    .where(inArray(orders.status, soldStatuses));

  const paymentStats = await db
    .select({ status: payments.status, value: count() })
    .from(payments)
    .groupBy(payments.status);

  const walletBalances = await db
    .select({
      totalBalance: sum(fiatWallets.balanceToman),
      wallets: count(),
    })
    .from(fiatWallets);

  const bestSellers = await db
    .select({
      productId: orderItems.productId,
      title: products.title,
      units: sum(orderItems.quantity),
      revenue: sum(orderItems.lineTotalToman),
    })
    .from(orderItems)
    .innerJoin(products, eq(products.id, orderItems.productId))
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      inArray(orders.status, [
        ORDER_STATUSES.paid,
        ORDER_STATUSES.pendingAdminReview,
        ORDER_STATUSES.processing,
        ORDER_STATUSES.completed,
      ]),
    )
    .groupBy(orderItems.productId, products.title)
    .orderBy(desc(sum(orderItems.lineTotalToman)))
    .limit(10);

  const customerRole = await db.query.roles.findFirst({ where: eq(roles.slug, "customer") });
  const newUsersDay = customerRole
    ? await db
        .select({ value: count() })
        .from(users)
        .where(and(eq(users.roleId, customerRole.id), gte(users.createdAt, dayStart)))
    : [{ value: 0 }];
  const newUsersWeek = customerRole
    ? await db
        .select({ value: count() })
        .from(users)
        .where(and(eq(users.roleId, customerRole.id), gte(users.createdAt, weekStart)))
    : [{ value: 0 }];
  const newUsersMonth = customerRole
    ? await db
        .select({ value: count() })
        .from(users)
        .where(and(eq(users.roleId, customerRole.id), gte(users.createdAt, monthStart)))
    : [{ value: 0 }];

  const awaitingReview = await db
    .select({ value: count() })
    .from(orders)
    .where(eq(orders.status, ORDER_STATUSES.pendingAdminReview));
  const awaitingFulfillment = await db
    .select({ value: count() })
    .from(orders)
    .where(inArray(orders.status, [ORDER_STATUSES.paid, ORDER_STATUSES.processing]));

  const chartStatuses = [
    ORDER_STATUSES.paid,
    ORDER_STATUSES.pendingAdminReview,
    ORDER_STATUSES.processing,
    ORDER_STATUSES.completed,
  ] as const;

  const salesDaily = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${orders.createdAt}), 'YYYY-MM-DD')`,
      revenue: sum(orders.payableToman),
      orderCount: count(),
    })
    .from(orders)
    .where(and(gte(orders.createdAt, weekStart), inArray(orders.status, [...chartStatuses])))
    .groupBy(sql`date_trunc('day', ${orders.createdAt})`)
    .orderBy(sql`date_trunc('day', ${orders.createdAt})`);

  const weekWindow = new Date(monthStart);
  weekWindow.setUTCDate(weekWindow.getUTCDate() - 90);
  const salesWeekly = await db
    .select({
      week: sql<string>`to_char(date_trunc('week', ${orders.createdAt}), 'IYYY-IW')`,
      revenue: sum(orders.payableToman),
      orderCount: count(),
    })
    .from(orders)
    .where(and(gte(orders.createdAt, weekWindow), inArray(orders.status, [...chartStatuses])))
    .groupBy(sql`date_trunc('week', ${orders.createdAt})`)
    .orderBy(sql`date_trunc('week', ${orders.createdAt})`);

  const monthWindow = new Date(monthStart);
  monthWindow.setUTCFullYear(monthWindow.getUTCFullYear() - 1);
  const salesMonthly = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${orders.createdAt}), 'YYYY-MM')`,
      revenue: sum(orders.payableToman),
      orderCount: count(),
    })
    .from(orders)
    .where(and(gte(orders.createdAt, monthWindow), inArray(orders.status, [...chartStatuses])))
    .groupBy(sql`date_trunc('month', ${orders.createdAt})`)
    .orderBy(sql`date_trunc('month', ${orders.createdAt})`);

  return {
    ordersByStatus: Object.fromEntries(orderStatusRows.map((r) => [r.status, Number(r.value)])),
    revenueToman: Number(revenuePaid[0]?.value ?? 0),
    paymentsByStatus: Object.fromEntries(paymentStats.map((r) => [r.status, Number(r.value)])),
    successfulPayments: Number(
      paymentStats.find((r) => r.status === PAYMENT_STATUSES.succeeded)?.value ?? 0,
    ),
    failedPayments: Number(
      paymentStats.find((r) => r.status === PAYMENT_STATUSES.failed)?.value ?? 0,
    ),
    customerWalletBalances: {
      totalToman: Number(walletBalances[0]?.totalBalance ?? 0),
      walletCount: Number(walletBalances[0]?.wallets ?? 0),
    },
    bestSellers: bestSellers.map((b) => ({
      productId: b.productId,
      title: b.title,
      units: Number(b.units ?? 0),
      revenueToman: Number(b.revenue ?? 0),
    })),
    newUsers: {
      day: Number(newUsersDay[0]?.value ?? 0),
      week: Number(newUsersWeek[0]?.value ?? 0),
      month: Number(newUsersMonth[0]?.value ?? 0),
    },
    awaitingReview: Number(awaitingReview[0]?.value ?? 0),
    awaitingFulfillment: Number(awaitingFulfillment[0]?.value ?? 0),
    charts: {
      daily: salesDaily.map((r) => ({
        day: r.day,
        revenueToman: Number(r.revenue ?? 0),
        orders: Number(r.orderCount ?? 0),
      })),
      weekly: salesWeekly.map((r) => ({
        week: r.week,
        revenueToman: Number(r.revenue ?? 0),
        orders: Number(r.orderCount ?? 0),
      })),
      monthly: salesMonthly.map((r) => ({
        month: r.month,
        revenueToman: Number(r.revenue ?? 0),
        orders: Number(r.orderCount ?? 0),
      })),
    },
  };
}
