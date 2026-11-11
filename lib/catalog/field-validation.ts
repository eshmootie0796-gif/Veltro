import { z } from "zod";
import { ValidationError } from "../errors";
import { FIELD_TYPES, type FieldType } from "./constants";
import type { FieldOption, FieldValidation, FieldVisibility } from "../db/schema/products";

export const fieldTypeSchema = z.enum(FIELD_TYPES);

export const fieldOptionSchema = z.object({
  value: z.string().min(1),
  labelEn: z.string().min(1),
  labelFa: z.string().min(1),
});

export const fieldValidationSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().positive().optional(),
  pattern: z.string().optional(),
});

export const fieldVisibilitySchema = z
  .object({
    fieldKey: z.string().min(1),
    equals: z.union([z.string(), z.number(), z.boolean()]).optional(),
    in: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
  })
  .refine((v) => v.equals !== undefined || (v.in !== undefined && v.in.length > 0), {
    message: "visibility requires equals or in",
  });

export const fieldDefinitionInputSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, "Field key must be snake_case"),
  labelEn: z.string().trim().min(1).max(120),
  labelFa: z.string().trim().min(1).max(120),
  fieldType: fieldTypeSchema,
  options: z.array(fieldOptionSchema).default([]),
  isRequired: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  validation: fieldValidationSchema.default({}),
  visibility: fieldVisibilitySchema.nullable().optional(),
});

export type FieldDefinitionInput = z.infer<typeof fieldDefinitionInputSchema>;

export type FieldDefinitionRecord = {
  key: string;
  labelEn: string;
  labelFa: string;
  fieldType: FieldType | string;
  options: FieldOption[];
  isRequired: boolean;
  validation: FieldValidation;
  visibility: FieldVisibility | null;
};

function isVisible(def: FieldDefinitionRecord, values: Record<string, unknown>): boolean {
  const rule = def.visibility;
  if (!rule) return true;
  const current = values[rule.fieldKey];
  if (rule.equals !== undefined) return current === rule.equals;
  if (rule.in) return rule.in.includes(current as string | number | boolean);
  return true;
}

function validateOne(
  def: FieldDefinitionRecord,
  raw: unknown,
  issues: Array<{ path: string; message: string }>,
) {
  const path = def.key;
  const rules = def.validation ?? {};

  if (raw === undefined || raw === null || raw === "") {
    if (def.isRequired) {
      issues.push({ path, message: `${def.labelEn} is required` });
    }
    return;
  }

  switch (def.fieldType as FieldType) {
    case "text":
    case "textarea":
    case "url":
    case "email":
    case "date": {
      if (typeof raw !== "string") {
        issues.push({ path, message: `${def.labelEn} must be a string` });
        return;
      }
      if (rules.minLength !== undefined && raw.length < rules.minLength) {
        issues.push({ path, message: `${def.labelEn} is too short` });
      }
      if (rules.maxLength !== undefined && raw.length > rules.maxLength) {
        issues.push({ path, message: `${def.labelEn} is too long` });
      }
      if (rules.pattern) {
        try {
          if (!new RegExp(rules.pattern).test(raw)) {
            issues.push({ path, message: `${def.labelEn} format is invalid` });
          }
        } catch {
          issues.push({ path, message: `${def.labelEn} has invalid server pattern` });
        }
      }
      if (def.fieldType === "email") {
        const emailOk = z.string().email().safeParse(raw).success;
        if (!emailOk) issues.push({ path, message: `${def.labelEn} must be a valid email` });
      }
      if (def.fieldType === "url") {
        const urlOk = z.string().url().safeParse(raw).success;
        if (!urlOk) issues.push({ path, message: `${def.labelEn} must be a valid URL` });
      }
      if (def.fieldType === "date") {
        const dateOk = !Number.isNaN(Date.parse(raw));
        if (!dateOk) issues.push({ path, message: `${def.labelEn} must be a valid date` });
      }
      break;
    }
    case "number": {
      const num = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(num)) {
        issues.push({ path, message: `${def.labelEn} must be a number` });
        return;
      }
      if (rules.min !== undefined && num < rules.min) {
        issues.push({ path, message: `${def.labelEn} is below minimum` });
      }
      if (rules.max !== undefined && num > rules.max) {
        issues.push({ path, message: `${def.labelEn} is above maximum` });
      }
      break;
    }
    case "boolean": {
      if (typeof raw !== "boolean") {
        issues.push({ path, message: `${def.labelEn} must be a boolean` });
      }
      break;
    }
    case "select": {
      if (typeof raw !== "string") {
        issues.push({ path, message: `${def.labelEn} must be a string` });
        return;
      }
      const allowed = new Set((def.options ?? []).map((o) => o.value));
      if (!allowed.has(raw)) {
        issues.push({ path, message: `${def.labelEn} has an invalid option` });
      }
      break;
    }
    case "multi_select": {
      if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string")) {
        issues.push({ path, message: `${def.labelEn} must be a string array` });
        return;
      }
      const allowed = new Set((def.options ?? []).map((o) => o.value));
      for (const value of raw as string[]) {
        if (!allowed.has(value)) {
          issues.push({ path, message: `${def.labelEn} has an invalid option` });
          break;
        }
      }
      break;
    }
    default: {
      issues.push({ path, message: `Unsupported field type for ${def.labelEn}` });
    }
  }
}

/**
 * Server-side validation of customer dynamic field payloads.
 * Never trust client-side validation.
 */
export function validateDynamicFieldValues(
  definitions: FieldDefinitionRecord[],
  input: Record<string, unknown>,
): Record<string, unknown> {
  const issues: Array<{ path: string; message: string }> = [];
  const output: Record<string, unknown> = {};

  for (const def of definitions) {
    if (!isVisible(def, input)) continue;
    const raw = input[def.key];
    validateOne(def, raw, issues);
    if (raw !== undefined) {
      output[def.key] = raw;
    }
  }

  // Reject unknown keys to prevent smuggling
  for (const key of Object.keys(input)) {
    if (!definitions.some((d) => d.key === key)) {
      issues.push({ path: key, message: "Unknown field" });
    }
  }

  if (issues.length > 0) {
    throw new ValidationError("Dynamic field validation failed", issues);
  }

  return output;
}
