import { eq } from "drizzle-orm";
import type { DbTransaction } from "../../db/transaction";
import { lockPlatformTreasuryForUpdate } from "../../db/transaction";
import { platformFiatTreasury } from "../../db/schema";
import { InsufficientFundsError, NotFoundError } from "../../errors";
import { newId } from "../../ids";
import { db } from "../../db";

export async function ensurePlatformTreasury() {
  const existing = await db.query.platformFiatTreasury.findFirst({
    where: eq(platformFiatTreasury.currencyCode, "IRT"),
  });
  if (existing) return existing;
  const id = newId();
  await db.insert(platformFiatTreasury).values({
    id,
    currencyCode: "IRT",
    balanceToman: 0,
  });
  return db.query.platformFiatTreasury.findFirst({
    where: eq(platformFiatTreasury.id, id),
  });
}

export async function creditPlatformTreasury(
  tx: DbTransaction,
  amountToman: number,
): Promise<{ balanceAfter: number }> {
  if (!Number.isInteger(amountToman) || amountToman < 0) {
    throw new InsufficientFundsError("Invalid treasury credit");
  }
  let row = await tx.query.platformFiatTreasury.findFirst({
    where: eq(platformFiatTreasury.currencyCode, "IRT"),
  });
  if (!row) {
    const id = newId();
    await tx.insert(platformFiatTreasury).values({
      id,
      currencyCode: "IRT",
      balanceToman: 0,
    });
    row = await tx.query.platformFiatTreasury.findFirst({
      where: eq(platformFiatTreasury.id, id),
    });
  }
  if (!row) throw new NotFoundError("Platform treasury missing");

  await lockPlatformTreasuryForUpdate(tx, row.id);
  const locked = await tx.query.platformFiatTreasury.findFirst({
    where: eq(platformFiatTreasury.id, row.id),
  });
  if (!locked) throw new NotFoundError("Platform treasury missing");

  const balanceAfter = locked.balanceToman + amountToman;
  await tx
    .update(platformFiatTreasury)
    .set({ balanceToman: balanceAfter, updatedAt: new Date() })
    .where(eq(platformFiatTreasury.id, locked.id));
  return { balanceAfter };
}

export async function debitPlatformTreasury(
  tx: DbTransaction,
  amountToman: number,
): Promise<{ balanceAfter: number }> {
  if (!Number.isInteger(amountToman) || amountToman < 0) {
    throw new InsufficientFundsError("Invalid treasury debit");
  }
  const row = await tx.query.platformFiatTreasury.findFirst({
    where: eq(platformFiatTreasury.currencyCode, "IRT"),
  });
  if (!row) throw new InsufficientFundsError("Insufficient system Toman liquidity");

  await lockPlatformTreasuryForUpdate(tx, row.id);
  const locked = await tx.query.platformFiatTreasury.findFirst({
    where: eq(platformFiatTreasury.id, row.id),
  });
  if (!locked) throw new NotFoundError("Platform treasury missing");
  if (locked.balanceToman < amountToman) {
    throw new InsufficientFundsError("Insufficient system Toman liquidity");
  }
  const balanceAfter = locked.balanceToman - amountToman;
  await tx
    .update(platformFiatTreasury)
    .set({ balanceToman: balanceAfter, updatedAt: new Date() })
    .where(eq(platformFiatTreasury.id, locked.id));
  return { balanceAfter };
}
