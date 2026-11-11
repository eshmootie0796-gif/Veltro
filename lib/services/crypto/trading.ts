import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  lockCryptoBalanceForUpdate,
  lockCryptoReserveForUpdate,
  lockFiatWalletByUserId,
  lockPlatformTreasuryForUpdate,
  withReservationTransaction,
} from "../../db/transaction";
import { cryptoTrades, platformFiatTreasury } from "../../db/schema";
import type { AuthUser } from "../../auth/rbac";
import { assertVerifiedCustomer } from "../../auth/rbac";
import { NotFoundError, ValidationError } from "../../errors";
import { newId } from "../../ids";
import { parseOrThrow, zCryptoAmount } from "../../validation/zod";
import { CRYPTO_TRADE_SIDES, CRYPTO_TX_TYPES } from "../../crypto/constants";
import { applyFiatLedgerEntry } from "../wallet/ledger";
import { applyCryptoLedgerEntry, getOrCreateCustomerCryptoBalance } from "./ledger";
import {
  applyBuyFee,
  applySellFee,
  quoteCryptoConvert,
  quoteCryptoToToman,
} from "./pricing";
import { creditCryptoReserve, debitCryptoReserve, getOrCreateReserve } from "./reserve";
import { getTradeFeeBps } from "./settings";
import { creditPlatformTreasury, debitPlatformTreasury } from "./treasury";

const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(120)
  .regex(/^[A-Za-z0-9_-]+$/);

const buySchema = z.object({
  currencyCode: z.string().trim().toUpperCase().min(2).max(16),
  amount: zCryptoAmount,
  idempotencyKey: idempotencyKeySchema,
});

const sellSchema = buySchema;

const convertSchema = z.object({
  sourceCurrencyCode: z.string().trim().toUpperCase().min(2).max(16),
  destinationCurrencyCode: z.string().trim().toUpperCase().min(2).max(16),
  amount: zCryptoAmount,
  idempotencyKey: idempotencyKeySchema,
});

async function findExistingTrade(userId: string, idempotencyKey: string) {
  return db.query.cryptoTrades.findFirst({
    where: and(eq(cryptoTrades.userId, userId), eq(cryptoTrades.idempotencyKey, idempotencyKey)),
  });
}

function mapTrade(row: typeof cryptoTrades.$inferSelect) {
  return {
    id: row.id,
    side: row.side,
    idempotencyKey: row.idempotencyKey,
    sourceAmount: row.sourceAmount,
    destinationAmount: row.destinationAmount,
    baseToman: row.baseToman,
    feeToman: row.feeToman,
    feeBps: Number(row.feeBps),
    payableOrPayoutToman: row.payableOrPayoutToman,
    pricingSnapshot: row.pricingSnapshot,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

function dNeg(amount: string): string {
  return `-${amount.replace(/^\+/, "")}`;
}

/** Lock order: fiat → crypto balances (sorted) → reserves (sorted) → treasury. */
async function lockTradeResources(
  tx: Parameters<Parameters<typeof withReservationTransaction>[0]>[0],
  input: {
    userId: string;
    currencyCodes: string[];
    touchTreasury: boolean;
  },
) {
  await lockFiatWalletByUserId(tx, input.userId);

  const codes = [...new Set(input.currencyCodes.map((c) => c.toUpperCase()))].sort();
  const balanceIds: string[] = [];
  for (const code of codes) {
    const { balance } = await getOrCreateCustomerCryptoBalance(tx, input.userId, code);
    balanceIds.push(balance.id);
  }
  for (const id of balanceIds.sort()) {
    await lockCryptoBalanceForUpdate(tx, id);
  }

  const reserveIds: string[] = [];
  for (const code of codes) {
    const { reserve } = await getOrCreateReserve(tx, code);
    reserveIds.push(reserve.id);
  }
  for (const id of reserveIds.sort()) {
    await lockCryptoReserveForUpdate(tx, id);
  }

  if (input.touchTreasury) {
    let treasury = await tx.query.platformFiatTreasury.findFirst({
      where: eq(platformFiatTreasury.currencyCode, "IRT"),
    });
    if (!treasury) {
      const id = newId();
      await tx.insert(platformFiatTreasury).values({
        id,
        currencyCode: "IRT",
        balanceToman: 0,
      });
      treasury = await tx.query.platformFiatTreasury.findFirst({
        where: eq(platformFiatTreasury.id, id),
      });
    }
    if (treasury) await lockPlatformTreasuryForUpdate(tx, treasury.id);
  }
}

export async function buyCrypto(customer: AuthUser, raw: unknown) {
  assertVerifiedCustomer(customer);
  const input = parseOrThrow(buySchema, raw);

  const existing = await findExistingTrade(customer.id, input.idempotencyKey);
  if (existing) return { ...mapTrade(existing), idempotentReplay: true as const };

  const feeBps = await getTradeFeeBps();

  try {
    return await withReservationTransaction(async (tx) => {
      await lockTradeResources(tx, {
        userId: customer.id,
        currencyCodes: [input.currencyCode],
        touchTreasury: true,
      });

      // Re-quote after locks so settlement uses current rates.
      const quote = await quoteCryptoToToman(input.currencyCode, input.amount);
      const { feeToman, payableToman } = applyBuyFee(quote.baseToman, feeBps);
      if (payableToman <= 0) throw new ValidationError("Payable amount invalid");

      const tradeId = newId();

      await applyFiatLedgerEntry(tx, {
        userId: customer.id,
        type: "trade",
        amountDelta: -payableToman,
        referenceType: "crypto_trade",
        referenceId: tradeId,
        note: `Buy ${input.amount} ${input.currencyCode}`,
      });
      await creditPlatformTreasury(tx, payableToman);
      await debitCryptoReserve(tx, input.currencyCode, input.amount);
      const cryptoCredit = await applyCryptoLedgerEntry(tx, {
        userId: customer.id,
        currencyCode: input.currencyCode,
        type: CRYPTO_TX_TYPES.trade,
        amountDelta: input.amount,
        referenceType: "crypto_trade",
        referenceId: tradeId,
        note: `Buy ${input.currencyCode}`,
      });

      const pricingSnapshot = {
        side: CRYPTO_TRADE_SIDES.buy,
        ...quote,
        feeBps,
        feeToman,
        payableToman,
      };

      await tx.insert(cryptoTrades).values({
        id: tradeId,
        userId: customer.id,
        side: CRYPTO_TRADE_SIDES.buy,
        idempotencyKey: input.idempotencyKey,
        sourceCurrencyId: null,
        destinationCurrencyId: cryptoCredit.currencyId,
        sourceAmount: "0",
        destinationAmount: input.amount,
        baseToman: quote.baseToman,
        feeToman,
        feeBps: String(feeBps),
        payableOrPayoutToman: payableToman,
        pricingSnapshot,
        status: "succeeded",
      });

      const row = await tx.query.cryptoTrades.findFirst({
        where: eq(cryptoTrades.id, tradeId),
      });
      return { ...mapTrade(row!), idempotentReplay: false as const };
    });
  } catch (error) {
    if (error instanceof Error && /unique|duplicate/i.test(error.message)) {
      const again = await findExistingTrade(customer.id, input.idempotencyKey);
      if (again) return { ...mapTrade(again), idempotentReplay: true as const };
    }
    throw error;
  }
}

export async function sellCrypto(customer: AuthUser, raw: unknown) {
  assertVerifiedCustomer(customer);
  const input = parseOrThrow(sellSchema, raw);

  const existing = await findExistingTrade(customer.id, input.idempotencyKey);
  if (existing) return { ...mapTrade(existing), idempotentReplay: true as const };

  const feeBps = await getTradeFeeBps();

  try {
    return await withReservationTransaction(async (tx) => {
      await lockTradeResources(tx, {
        userId: customer.id,
        currencyCodes: [input.currencyCode],
        touchTreasury: true,
      });

      const quote = await quoteCryptoToToman(input.currencyCode, input.amount);
      const { feeToman, payoutToman } = applySellFee(quote.baseToman, feeBps);

      const tradeId = newId();

      const cryptoDebit = await applyCryptoLedgerEntry(tx, {
        userId: customer.id,
        currencyCode: input.currencyCode,
        type: CRYPTO_TX_TYPES.trade,
        amountDelta: dNeg(input.amount),
        referenceType: "crypto_trade",
        referenceId: tradeId,
        note: `Sell ${input.currencyCode}`,
      });
      await creditCryptoReserve(tx, input.currencyCode, input.amount);
      await debitPlatformTreasury(tx, payoutToman);
      await applyFiatLedgerEntry(tx, {
        userId: customer.id,
        type: "trade",
        amountDelta: payoutToman,
        referenceType: "crypto_trade",
        referenceId: tradeId,
        note: `Sell ${input.amount} ${input.currencyCode}`,
      });

      const pricingSnapshot = {
        side: CRYPTO_TRADE_SIDES.sell,
        ...quote,
        feeBps,
        feeToman,
        payoutToman,
      };

      await tx.insert(cryptoTrades).values({
        id: tradeId,
        userId: customer.id,
        side: CRYPTO_TRADE_SIDES.sell,
        idempotencyKey: input.idempotencyKey,
        sourceCurrencyId: cryptoDebit.currencyId,
        destinationCurrencyId: null,
        sourceAmount: input.amount,
        destinationAmount: "0",
        baseToman: quote.baseToman,
        feeToman,
        feeBps: String(feeBps),
        payableOrPayoutToman: payoutToman,
        pricingSnapshot,
        status: "succeeded",
      });

      const row = await tx.query.cryptoTrades.findFirst({
        where: eq(cryptoTrades.id, tradeId),
      });
      return { ...mapTrade(row!), idempotentReplay: false as const };
    });
  } catch (error) {
    if (error instanceof Error && /unique|duplicate/i.test(error.message)) {
      const again = await findExistingTrade(customer.id, input.idempotencyKey);
      if (again) return { ...mapTrade(again), idempotentReplay: true as const };
    }
    throw error;
  }
}

export async function convertCrypto(customer: AuthUser, raw: unknown) {
  assertVerifiedCustomer(customer);
  const input = parseOrThrow(convertSchema, raw);
  if (input.sourceCurrencyCode === input.destinationCurrencyCode) {
    throw new ValidationError("Source and destination must differ");
  }

  const existing = await findExistingTrade(customer.id, input.idempotencyKey);
  if (existing) return { ...mapTrade(existing), idempotentReplay: true as const };

  const feeBps = await getTradeFeeBps();

  try {
    return await withReservationTransaction(async (tx) => {
      await lockTradeResources(tx, {
        userId: customer.id,
        currencyCodes: [input.sourceCurrencyCode, input.destinationCurrencyCode],
        touchTreasury: false,
      });

      const quote = await quoteCryptoConvert({
        sourceSymbol: input.sourceCurrencyCode,
        destinationSymbol: input.destinationCurrencyCode,
        sourceAmount: input.amount,
        feeBps,
      });

      const tradeId = newId();

      // Platform: take source into reserve, pay destination from reserve.
      await creditCryptoReserve(tx, input.sourceCurrencyCode, input.amount);
      await debitCryptoReserve(tx, input.destinationCurrencyCode, quote.destinationAmount);

      const src = await applyCryptoLedgerEntry(tx, {
        userId: customer.id,
        currencyCode: input.sourceCurrencyCode,
        type: CRYPTO_TX_TYPES.conversion,
        amountDelta: dNeg(input.amount),
        referenceType: "crypto_trade",
        referenceId: tradeId,
        note: `Convert from ${input.sourceCurrencyCode}`,
      });
      const dst = await applyCryptoLedgerEntry(tx, {
        userId: customer.id,
        currencyCode: input.destinationCurrencyCode,
        type: CRYPTO_TX_TYPES.conversion,
        amountDelta: quote.destinationAmount,
        referenceType: "crypto_trade",
        referenceId: tradeId,
        note: `Convert to ${input.destinationCurrencyCode}`,
      });

      await tx.insert(cryptoTrades).values({
        id: tradeId,
        userId: customer.id,
        side: CRYPTO_TRADE_SIDES.convert,
        idempotencyKey: input.idempotencyKey,
        sourceCurrencyId: src.currencyId,
        destinationCurrencyId: dst.currencyId,
        sourceAmount: input.amount,
        destinationAmount: quote.destinationAmount,
        baseToman: 0,
        feeToman: 0,
        feeBps: String(feeBps),
        payableOrPayoutToman: 0,
        pricingSnapshot: { side: CRYPTO_TRADE_SIDES.convert, ...quote },
        status: "succeeded",
      });

      const row = await tx.query.cryptoTrades.findFirst({
        where: eq(cryptoTrades.id, tradeId),
      });
      return { ...mapTrade(row!), idempotentReplay: false as const };
    });
  } catch (error) {
    if (error instanceof Error && /unique|duplicate/i.test(error.message)) {
      const again = await findExistingTrade(customer.id, input.idempotencyKey);
      if (again) return { ...mapTrade(again), idempotentReplay: true as const };
    }
    throw error;
  }
}

export async function listCryptoTrades(customer: AuthUser, limit = 50) {
  assertVerifiedCustomer(customer);
  const rows = await db.query.cryptoTrades.findMany({
    where: eq(cryptoTrades.userId, customer.id),
    orderBy: [desc(cryptoTrades.createdAt)],
    limit: Math.min(Math.max(limit, 1), 100),
  });
  return rows.map(mapTrade);
}

export async function getCryptoTrade(customer: AuthUser, tradeId: string) {
  assertVerifiedCustomer(customer);
  const row = await db.query.cryptoTrades.findFirst({
    where: and(eq(cryptoTrades.id, tradeId), eq(cryptoTrades.userId, customer.id)),
  });
  if (!row) throw new NotFoundError("Trade not found");
  return mapTrade(row);
}

export async function previewBuyQuote(currencyCode: string, amount: string) {
  const feeBps = await getTradeFeeBps();
  const quote = await quoteCryptoToToman(currencyCode, amount);
  const fee = applyBuyFee(quote.baseToman, feeBps);
  return { ...quote, feeBps, ...fee };
}

export async function previewSellQuote(currencyCode: string, amount: string) {
  const feeBps = await getTradeFeeBps();
  const quote = await quoteCryptoToToman(currencyCode, amount);
  const fee = applySellFee(quote.baseToman, feeBps);
  return { ...quote, feeBps, ...fee };
}

export async function previewConvertQuote(
  sourceCurrencyCode: string,
  destinationCurrencyCode: string,
  amount: string,
) {
  const feeBps = await getTradeFeeBps();
  return quoteCryptoConvert({
    sourceSymbol: sourceCurrencyCode,
    destinationSymbol: destinationCurrencyCode,
    sourceAmount: amount,
    feeBps,
  });
}
