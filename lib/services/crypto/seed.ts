import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { cryptoReserves, currencies, platformFiatTreasury } from "../../db/schema";
import { newId } from "../../ids";
import { seedCryptoTradeSettings } from "./settings";
import { ensurePlatformTreasury } from "./treasury";

const DEFAULT_RESERVE_BALANCES: Record<string, string> = {
  BTC: "10",
  ETH: "100",
  USDT: "100000",
};

export async function seedCryptoTradingInfrastructure() {
  await seedCryptoTradeSettings();
  await ensurePlatformTreasury();

  // Seed platform IRT liquidity for sells (idempotent floor).
  const treasury = await db.query.platformFiatTreasury.findFirst({
    where: eq(platformFiatTreasury.currencyCode, "IRT"),
  });
  if (treasury && treasury.balanceToman < 1_000_000_000) {
    await db
      .update(platformFiatTreasury)
      .set({ balanceToman: 5_000_000_000, updatedAt: new Date() })
      .where(eq(platformFiatTreasury.id, treasury.id));
  }

  for (const [code, balance] of Object.entries(DEFAULT_RESERVE_BALANCES)) {
    const currency = await db.query.currencies.findFirst({
      where: and(eq(currencies.code, code), eq(currencies.kind, "crypto")),
    });
    if (!currency) continue;
    const existing = await db.query.cryptoReserves.findFirst({
      where: eq(cryptoReserves.currencyId, currency.id),
    });
    if (existing) continue;
    await db.insert(cryptoReserves).values({
      id: newId(),
      currencyId: currency.id,
      balance,
    });
  }
}
