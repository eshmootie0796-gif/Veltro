import { Decimal } from "decimal.js";

/**
 * Safe decimal helpers. Never use JS number floats for money/rate math.
 * Rounding policy for Toman: ROUND_HALF_UP to 0 decimal places.
 */
Decimal.set({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
});

export { Decimal };

export type DecimalValue = ConstructorParameters<typeof Decimal>[0];

export function d(value: DecimalValue): Decimal {
  return new Decimal(value);
}

/** Convert a decimal amount to integer Toman (half-up). */
export function toTomanInt(value: DecimalValue): number {
  const n = d(value).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  if (!n.isFinite() || n.isNegative()) {
    throw new Error("Invalid Toman amount");
  }
  const asNumber = n.toNumber();
  if (!Number.isSafeInteger(asNumber)) {
    throw new Error("Toman amount exceeds safe integer range");
  }
  return asNumber;
}

/** basis points fee: amount * bps / 10000 */
export function applyBps(amount: DecimalValue, bps: number): Decimal {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) {
    throw new Error("Invalid basis points");
  }
  return d(amount).mul(bps).div(10000);
}

export function multiply(a: DecimalValue, b: DecimalValue): Decimal {
  return d(a).mul(b);
}

export function add(...values: DecimalValue[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.add(d(v)), d(0));
}
