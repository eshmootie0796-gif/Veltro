import { spawnSync } from "child_process";

const suites = [
  "test:auth",
  "test:catalog",
  "test:pricing",
  "test:orders",
  "test:payments",
  "test:crypto",
  "test:categories",
  "test:admin",
  "test:concurrent",
] as const;

const results: Array<{ suite: string; ok: boolean; code: number | null }> = [];

for (const suite of suites) {
  const run = spawnSync("npm", ["run", suite], {
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  results.push({ suite, ok: run.status === 0, code: run.status });
  if (run.status !== 0) {
    console.error(JSON.stringify({ ok: false, failed: suite, results }));
    process.exit(run.status ?? 1);
  }
}

console.log(JSON.stringify({ ok: true, suite: "run-all-tests", results }));
process.exit(0);
