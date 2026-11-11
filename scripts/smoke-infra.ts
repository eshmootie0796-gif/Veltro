import { z } from "zod";
import { parseOrThrow } from "../lib/validation/zod";
import { ValidationError } from "../lib/errors";
import { buildPaginationMeta, parseListQuery } from "../lib/query/pagination";
import { logger } from "../lib/logger";
import { hashOpaqueCode, safeEqualString } from "../lib/crypto/opaque";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const parsed = parseOrThrow(z.object({ email: z.string().email() }), {
    email: "user@example.com",
  });
  assert(parsed.email === "user@example.com", "zod parse failed");

  let threw = false;
  try {
    parseOrThrow(z.object({ email: z.string().email() }), { email: "bad" });
  } catch (error) {
    threw = error instanceof ValidationError;
  }
  assert(threw, "expected ValidationError");

  const list = parseListQuery({ page: "2", pageSize: "10", order: "asc" });
  assert(list.page === 2 && list.pageSize === 10, "list query parse failed");

  const meta = buildPaginationMeta(25, 2, 10);
  assert(meta.totalPages === 3 && meta.hasNext && meta.hasPrev, "pagination meta failed");

  const hash = hashOpaqueCode("123456");
  assert(hash.length === 64, "code hash length");
  assert(safeEqualString("abc", "abc"), "safeEqual true");
  assert(!safeEqualString("abc", "abd"), "safeEqual false");

  // Ensure logger redacts secrets (visual/structural smoke — no throw)
  logger.info("smoke_logger", { password: "super-secret", userId: "u1" });

  console.log(JSON.stringify({ ok: true, suite: "smoke-infra" }));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
