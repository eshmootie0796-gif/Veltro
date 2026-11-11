export const PAYMENT_METHODS = {
  walletFiat: "wallet_fiat",
  simulatedGateway: "simulated_gateway",
} as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[keyof typeof PAYMENT_METHODS];

export const PAYMENT_STATUSES = {
  pending: "pending",
  succeeded: "succeeded",
  failed: "failed",
  refunded: "refunded",
  forfeitedRefund: "forfeited_refund",
} as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[keyof typeof PAYMENT_STATUSES];

export const PAYMENT_PURPOSES = {
  order: "order",
  topup: "topup",
} as const;

export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[keyof typeof PAYMENT_PURPOSES];

export const MOCK_OUTCOMES = {
  success: "success",
  failure: "failure",
} as const;

export type MockOutcome = (typeof MOCK_OUTCOMES)[keyof typeof MOCK_OUTCOMES];

export const WALLET_TX_TYPES = {
  deposit: "deposit",
  payment: "payment",
  refund: "refund",
  adjustment: "adjustment",
} as const;

export const SETTINGS_KEYS = {
  topupMinToman: "wallet.topup.min_toman",
  topupMaxToman: "wallet.topup.max_toman",
} as const;

/** Defaults when settings rows missing. */
export const DEFAULT_TOPUP_MIN_TOMAN = 10_000;
export const DEFAULT_TOPUP_MAX_TOMAN = 50_000_000;
