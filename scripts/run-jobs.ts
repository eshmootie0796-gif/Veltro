import { runMaintenanceJobs } from "../lib/services/jobs/maintenance";

async function main() {
  const data = await runMaintenanceJobs();
  console.log(JSON.stringify({ ok: true, suite: "run-jobs", data }));
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
