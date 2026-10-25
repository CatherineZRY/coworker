import { startDaemon } from "./index.js";

const handle = await startDaemon({
  port: process.env.PORT ? Number.parseInt(process.env.PORT, 10) : undefined,
  verbose: process.env.COWORKER_DEBUG === "1",
});

process.stdout.write(`coworker ready at ${handle.openUrl}\n`);

const shutdown = async (signal: string) => {
  handle.logger.info("shutting down", { signal });
  await handle.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
