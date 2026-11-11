export const CRYPTO_TRADE_SIDES = {
  buy: "buy",
  sell: "sell",
  convert: "convert",
} as const;

export type CryptoTradeSide = (typeof CRYPTO_TRADE_SIDES)[keyof typeof CRYPTO_TRADE_SIDES];

export const SETTINGS_KEYS = {
  tradeFeeBps: "crypto.trade.fee_bps",
} as const;

/** Default shared fee: 1.00% */
export const DEFAULT_TRADE_FEE_BPS = 100;

export const CRYPTO_TX_TYPES = {
  deposit: "deposit",
  withdrawal: "withdrawal",
  conversion: "conversion",
  trade: "trade",
  adjustment: "adjustment",
} as const;
