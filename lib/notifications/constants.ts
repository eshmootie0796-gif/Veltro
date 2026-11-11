export const NOTIFICATION_TYPES = {
  orderCreated: "order_created",
  paymentSuccessful: "payment_successful",
  paymentFailed: "payment_failed",
  processingStarted: "processing_started",
  orderDelivered: "order_delivered",
  cancellationApproved: "cancellation_approved",
  cancellationRejected: "cancellation_rejected",
  walletRefund: "wallet_refund",
  discount: "discount",
} as const;

export type NotificationType =
  (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

export const NOTIFICATION_TEMPLATE_SEEDS = [
  {
    slug: NOTIFICATION_TYPES.orderCreated,
    titleTemplate: "Order created",
    bodyTemplate: "Your order {{orderId}} was created and awaits payment.",
  },
  {
    slug: NOTIFICATION_TYPES.paymentSuccessful,
    titleTemplate: "Payment successful",
    bodyTemplate: "Payment for order {{orderId}} succeeded.",
  },
  {
    slug: NOTIFICATION_TYPES.paymentFailed,
    titleTemplate: "Payment failed",
    bodyTemplate: "Payment for order {{orderId}} failed. Create a new order to retry.",
  },
  {
    slug: NOTIFICATION_TYPES.processingStarted,
    titleTemplate: "Order processing",
    bodyTemplate: "Order {{orderId}} is now being processed.",
  },
  {
    slug: NOTIFICATION_TYPES.orderDelivered,
    titleTemplate: "Order delivered",
    bodyTemplate: "Order {{orderId}} was marked completed/delivered.",
  },
  {
    slug: NOTIFICATION_TYPES.cancellationApproved,
    titleTemplate: "Cancellation approved",
    bodyTemplate: "Cancellation for order {{orderId}} was approved.",
  },
  {
    slug: NOTIFICATION_TYPES.cancellationRejected,
    titleTemplate: "Cancellation rejected",
    bodyTemplate: "Cancellation for order {{orderId}} was rejected.",
  },
  {
    slug: NOTIFICATION_TYPES.walletRefund,
    titleTemplate: "Wallet refund",
    bodyTemplate: "A refund of {{amountToman}} Toman was credited to your wallet.",
  },
  {
    slug: NOTIFICATION_TYPES.discount,
    titleTemplate: "New discount: {{code}}",
    bodyTemplate: "{{name}} is now available. Code: {{code}}",
  },
] as const;

export const SETTINGS_KEYS = {
  defaultServiceFeeBps: "platform.default_service_fee_bps",
  notificationsEnabled: "notifications.enabled",
} as const;

export const DEFAULT_SERVICE_FEE_BPS = 0;
