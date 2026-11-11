import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import { db } from "../../db";
import {
  fiatWalletTransactions,
  fiatWallets,
  orders,
  payments,
  roles,
  users,
} from "../../db/schema";
import type { AuthUser } from "../../auth/rbac";
import { assertAdmin } from "../../auth/rbac";
import { NotFoundError } from "../../errors";
import {
  buildPaginationMeta,
  paginationOffset,
  parseListQuery,
} from "../../query/pagination";

export async function listCustomers(actor: AuthUser, query: unknown) {
  assertAdmin(actor);
  const parsed = parseListQuery(query);
  const status = typeof (query as { status?: string }).status === "string"
    ? (query as { status: string }).status
    : undefined;

  const customerRole = await db.query.roles.findFirst({ where: eq(roles.slug, "customer") });
  if (!customerRole) return { items: [], meta: buildPaginationMeta(0, parsed.page, parsed.pageSize) };

  const filters = [eq(users.roleId, customerRole.id)];
  if (status) filters.push(eq(users.status, status));
  if (parsed.q) {
    const q = `%${parsed.q}%`;
    filters.push(
      or(ilike(users.email, q), ilike(users.username, q), ilike(users.name, q))!,
    );
  }

  const where = and(...filters);
  const totalRows = await db.select({ value: count() }).from(users).where(where);
  const total = Number(totalRows[0]?.value ?? 0);
  const rows = await db.query.users.findMany({
    where,
    orderBy: [desc(users.createdAt)],
    limit: parsed.pageSize,
    offset: paginationOffset(parsed.page, parsed.pageSize),
    with: { role: true },
  });

  return {
    items: rows.map((u) => ({
      id: u.id,
      email: u.email,
      username: u.username,
      name: u.name,
      status: u.status,
      emailVerified: u.emailVerified?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
    })),
    meta: buildPaginationMeta(total, parsed.page, parsed.pageSize),
  };
}

export async function getCustomerAdmin(actor: AuthUser, userId: string) {
  assertAdmin(actor);
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    with: { role: true },
  });
  if (!user || user.role?.slug !== "customer") throw new NotFoundError("Customer not found");

  const wallet = await db.query.fiatWallets.findFirst({
    where: eq(fiatWallets.userId, userId),
  });
  const orderRows = await db.query.orders.findMany({
    where: eq(orders.userId, userId),
    orderBy: [desc(orders.createdAt)],
    limit: 50,
  });
  const paymentRows = await db.query.payments.findMany({
    where: eq(payments.userId, userId),
    orderBy: [desc(payments.createdAt)],
    limit: 50,
  });
  const txRows = wallet
    ? await db.query.fiatWalletTransactions.findMany({
        where: eq(fiatWalletTransactions.walletId, wallet.id),
        orderBy: [desc(fiatWalletTransactions.createdAt)],
        limit: 50,
      })
    : [];

  return {
    id: user.id,
    email: user.email,
    username: user.username,
    name: user.name,
    status: user.status,
    emailVerified: user.emailVerified?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    wallet: wallet
      ? { id: wallet.id, balanceToman: wallet.balanceToman }
      : null,
    orders: orderRows.map((o) => ({
      id: o.id,
      status: o.status,
      payableToman: o.payableToman,
      createdAt: o.createdAt.toISOString(),
    })),
    payments: paymentRows.map((p) => ({
      id: p.id,
      status: p.status,
      method: p.method,
      amountToman: p.amountToman,
      createdAt: p.createdAt.toISOString(),
    })),
    walletTransactions: txRows.map((t) => ({
      id: t.id,
      type: t.type,
      amountToman: t.amountToman,
      balanceAfter: t.balanceAfter,
      createdAt: t.createdAt.toISOString(),
    })),
  };
}
