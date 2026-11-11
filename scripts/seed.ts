import { seedBaseline } from "../lib/db/seeds/run";
import { logger } from "../lib/logger";

seedBaseline()
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    logger.error("seed_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    process.exit(1);
  });
