type LogLevel = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

const SECRET_KEY =
  /(secret|password|passwd|token|authorization|cookie|database_url|api[_-]?key|private|credential|hash)/i;

const REDACTED = "[REDACTED]";

function redactValue(key: string, value: unknown): unknown {
  if (SECRET_KEY.test(key)) {
    return REDACTED;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => redactValue(String(index), item));
  }
  if (value && typeof value === "object") {
    return redactObject(value as Record<string, unknown>);
  }
  if (typeof value === "string" && value.length > 500) {
    return `${value.slice(0, 500)}…`;
  }
  return value;
}

function redactObject(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = redactValue(key, value);
  }
  return out;
}

function write(level: LogLevel, message: string, fields?: LogFields) {
  const entry = {
    level,
    message,
    time: new Date().toISOString(),
    ...(fields ? redactObject(fields) : {}),
  };

  const line = JSON.stringify(entry);
  switch (level) {
    case "error":
      console.error(line);
      break;
    case "warn":
      console.warn(line);
      break;
    default:
      console.log(line);
  }
}

/**
 * Structured logger. Redacts secret-like keys and avoids dumping large blobs.
 * Do not pass raw PII (full card numbers, passwords, session tokens) in fields.
 */
export const logger = {
  debug: (message: string, fields?: LogFields) => write("debug", message, fields),
  info: (message: string, fields?: LogFields) => write("info", message, fields),
  warn: (message: string, fields?: LogFields) => write("warn", message, fields),
  error: (message: string, fields?: LogFields) => write("error", message, fields),
};
