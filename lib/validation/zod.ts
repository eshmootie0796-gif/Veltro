import { z, type ZodTypeAny, type ZodIssue } from "zod";
import { ValidationError } from "../errors";

/**
 * Parse unknown input with a Zod schema.
 * Throws ValidationError with safe field details (never raw secrets assumed present).
 */
export function parseOrThrow<TSchema extends ZodTypeAny>(
  schema: TSchema,
  input: unknown,
  message = "Validation failed",
): z.infer<TSchema> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(message, formatZodIssues(result.error.issues));
  }
  return result.data;
}

export function formatZodIssues(issues: ZodIssue[]) {
  return issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
    code: issue.code,
  }));
}

/** Common reusable field schemas. */
export const zId = z.string().uuid();
export const zEmail = z.string().email().max(320);
export const zNonEmpty = z.string().trim().min(1);
export const zPaginationPage = z.coerce.number().int().min(1).default(1);
export const zPaginationPageSize = z.coerce.number().int().min(1).max(100).default(20);
export const zSortOrder = z.enum(["asc", "desc"]).default("desc");

/**
 * Integer Toman amount (non-negative). Server-side money input only.
 */
export const zToman = z.number().int().nonnegative();

/**
 * Cryptocurrency quantity as a decimal string (no JS float).
 */
export const zCryptoAmount = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, "Invalid decimal amount");
