import { PRICING_QUOTE_TTL_MS } from "../pricing/constants";

export const ORDER_PAYMENT_TTL_MS = PRICING_QUOTE_TTL_MS; // 15 minutes

export const ORDER_STATUSES = {
  awaitingPayment: "awaiting_payment",
  expired: "expired",
  paid: "paid",
  pendingAdminReview: "pending_admin_review",
  processing: "processing",
  completed: "completed",
  cancellationRequested: "cancellation_requested",
  cancelled: "cancelled",
  rejected: "rejected",
} as const;

export type OrderStatus = (typeof ORDER_STATUSES)[keyof typeof ORDER_STATUSES];

export const CUSTOMER_VISIBLE_STATUSES: readonly OrderStatus[] = [
  ORDER_STATUSES.paid,
  ORDER_STATUSES.pendingAdminReview,
  ORDER_STATUSES.processing,
  ORDER_STATUSES.completed,
  ORDER_STATUSES.cancellationRequested,
  ORDER_STATUSES.cancelled,
  ORDER_STATUSES.rejected,
  ORDER_STATUSES.awaitingPayment,
  ORDER_STATUSES.expired,
];

/** Statuses where capacity/discount holds are still active. */
export const RESERVATION_HOLD_STATUSES: readonly OrderStatus[] = [
  ORDER_STATUSES.awaitingPayment,
];

export const PRE_DELIVERY_STATUSES: readonly OrderStatus[] = [
  ORDER_STATUSES.paid,
  ORDER_STATUSES.pendingAdminReview,
  ORDER_STATUSES.processing,
  ORDER_STATUSES.cancellationRequested,
];

/**
 * Allowed admin free-form status updates (excludes `paid` — payment module only).
 * `cancellation_requested` → `processing` uses adminRejectCancellation.
 */
export const ADMIN_ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  [ORDER_STATUSES.awaitingPayment]: [
    ORDER_STATUSES.cancelled,
    ORDER_STATUSES.rejected,
  ],
  [ORDER_STATUSES.expired]: [],
  [ORDER_STATUSES.paid]: [
    ORDER_STATUSES.pendingAdminReview,
    ORDER_STATUSES.processing,
    ORDER_STATUSES.completed,
    ORDER_STATUSES.cancelled,
    ORDER_STATUSES.rejected,
  ],
  [ORDER_STATUSES.pendingAdminReview]: [
    ORDER_STATUSES.processing,
    ORDER_STATUSES.completed,
    ORDER_STATUSES.cancelled,
    ORDER_STATUSES.rejected,
  ],
  [ORDER_STATUSES.processing]: [
    ORDER_STATUSES.completed,
    ORDER_STATUSES.cancelled,
    ORDER_STATUSES.rejected,
  ],
  [ORDER_STATUSES.cancellationRequested]: [
    ORDER_STATUSES.cancelled,
    ORDER_STATUSES.rejected,
  ],
  [ORDER_STATUSES.completed]: [],
  [ORDER_STATUSES.cancelled]: [],
  [ORDER_STATUSES.rejected]: [],
};

