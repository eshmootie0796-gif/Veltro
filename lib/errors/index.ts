/**
 * Centralized application errors.
 * Map these to HTTP responses in route handlers — never leak stacks or SQL.
 */

export type ErrorDetails = Record<string, unknown> | unknown[] | undefined;

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: ErrorDetails;

  constructor(code: string, message: string, status = 400, details?: ErrorDetails) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed", details?: ErrorDetails) {
    super("VALIDATION_ERROR", message, 400, details);
    this.name = "ValidationError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super("UNAUTHORIZED", message, 401);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super("FORBIDDEN", message, 403);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super("NOT_FOUND", message, 404);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict", details?: ErrorDetails) {
    super("CONFLICT", message, 409, details);
    this.name = "ConflictError";
  }
}

export class InsufficientFundsError extends AppError {
  constructor(message = "Insufficient funds") {
    super("INSUFFICIENT_FUNDS", message, 409);
    this.name = "InsufficientFundsError";
  }
}

export class CapacityExceededError extends AppError {
  constructor(message = "Insufficient product capacity") {
    super("CAPACITY_EXCEEDED", message, 409);
    this.name = "CapacityExceededError";
  }
}

export class InternalError extends AppError {
  constructor(message = "Internal server error") {
    super("INTERNAL_ERROR", message, 500);
    this.name = "InternalError";
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
