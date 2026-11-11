import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError, isAppError, ValidationError } from "../errors";
import { logger } from "../logger";

export type ApiSuccessMeta = Record<string, unknown>;

export type ApiSuccessBody<T> = {
  success: true;
  data: T;
  meta?: ApiSuccessMeta;
};

export type ApiErrorBody = {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export function apiSuccess<T>(data: T, init?: { status?: number; meta?: ApiSuccessMeta }) {
  const body: ApiSuccessBody<T> = {
    success: true,
    data,
    ...(init?.meta ? { meta: init.meta } : {}),
  };
  return NextResponse.json(body, { status: init?.status ?? 200 });
}

export function apiError(
  code: string,
  message: string,
  init?: { status?: number; details?: unknown },
) {
  const body: ApiErrorBody = {
    success: false,
    error: {
      code,
      message,
      ...(init?.details !== undefined ? { details: init.details } : {}),
    },
  };
  return NextResponse.json(body, { status: init?.status ?? 400 });
}

export function apiFromAppError(error: AppError) {
  return apiError(error.code, error.message, {
    status: error.status,
    details: error.details,
  });
}

/**
 * Map unknown failures to a safe API response.
 * Logs internally; never returns stack traces or secrets.
 */
export function apiFromUnknownError(error: unknown, context?: string) {
  if (isAppError(error)) {
    if (error.status >= 500) {
      logger.error("app_error", { code: error.code, context });
    }
    return apiFromAppError(error);
  }

  if (error instanceof ZodError) {
    const validation = new ValidationError("Validation failed", error.flatten());
    return apiFromAppError(validation);
  }

  logger.error("unhandled_error", {
    context,
    name: error instanceof Error ? error.name : "unknown",
    message: error instanceof Error ? error.message : "unknown",
  });

  return apiError("INTERNAL_ERROR", "Internal server error", { status: 500 });
}
