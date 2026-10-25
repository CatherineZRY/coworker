import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type CoworkerConfig,
  type CoworkerPaths,
  createRunners,
  ensureHome,
  ensureToken,
  getPaths,
  loadConfig,
  WorktreeManager,
  writeDefaultConfig,
} from "@coworker/adapters";
import type { Core } from "@coworker/core";
import { createCore, createDatabase } from "@coworker/core";
import type { FastifyInstance } from "fastify";
import { createLogger, type Logger } from "./logger.js";
import { Scheduler } from "./scheduler.js";
import { buildServer } from "./server.js";
import { syncCodexThreads } from "./sync.js";

export interface StartDaemonOptions {
  home?: string;
  host?: string;
  port?: number;
  config?: Partial<CoworkerConfig>;
  verbose?: boolean;
  webDist?: string;
}

export interface DaemonHandle {
  app: FastifyInstance;
  core: Core;
  scheduler: Scheduler;
  paths: CoworkerPaths;
  config: CoworkerConfig;
  logger: Logger;
  port: number;
  host: string;
  url: string;
  openUrl: string;
  close: () => Promise<void>;
}

export async function startDaemon(options: StartDaemonOptions = {}): Promise<DaemonHandle> {
  const paths = ensureHome(getPaths(options.home));
  writeDefaultConfig(paths);
  const token = ensureToken(paths);

  const fileConfig = loadConfig(paths);
  const config: CoworkerConfig = {
    ...fileConfig,
    ...options.config,
    host: options.host ?? options.config?.host ?? fileConfig.host,
    port: options.port ?? options.config?.port ?? fileConfig.port,
    workers: {
      claudeCode: { ...fileConfig.workers.claudeCode, ...options.config?.workers?.claudeCode },
      codex: { ...fileConfig.workers.codex, ...options.config?.workers?.codex },
      cursor: { ...fileConfig.workers.cursor, ...options.config?.workers?.cursor },
    },
  };

  const logger = createLogger(options.verbose ?? process.env.COWORKER_DEBUG === "1");
  const ctx = createDatabase(paths.dbPath);
  const core = createCore(ctx);
  const runners = createRunners(config);
  const worktrees = new WorktreeManager(paths.worktreesDir);
  const scheduler = new Scheduler({ core, runners, worktrees, config, paths, logger });

  const webDist = options.webDist ?? resolveWebDist();
  const app = await buildServer({
    core,
    scheduler,
    runners,
    config,
    paths,
    token,
    logger,
    webDist,
  });

  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await app.close().catch(() => undefined);
    ctx.close();
    if (/EADDRINUSE/.test(message)) {
      throw new Error(
        `Port ${config.port} is already in use. Is coworker already running? Try \`coworker status\`.`,
      );
    }
    throw error;
  }

  scheduler.start();
  try {
    syncCodexThreads(core, true);
  } catch (error) {
    logger.warn("initial Codex thread sync failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const syncTimer = setInterval(() => {
    try {
      syncCodexThreads(core, false);
    } catch (error) {
      logger.warn("Codex thread sync failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, 10_000);
  syncTimer.unref();

  writeFileSync(paths.pidPath, `${process.pid}\n`, { mode: 0o600 });
  writeFileSync(paths.portPath, `${config.port}\n`, { mode: 0o600 });

  const url = `http://${config.host}:${config.port}/`;
  const openUrl = `${url}?token=${encodeURIComponent(token)}`;

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    clearInterval(syncTimer);
    scheduler.stop();
    await app.close().catch(() => undefined);
    ctx.close();
    removeIfOwned(paths.pidPath);
    removeIfOwned(paths.portPath);
  };

  logger.info("coworker daemon listening", {
    url,
    home: paths.home,
    web: webDist != null && existsSync(webDist),
  });

  return {
    app,
    core,
    scheduler,
    paths,
    config,
    logger,
    port: config.port,
    host: config.host,
    url,
    openUrl,
    close,
  };
}

export function resolveWebDist(): string | null {
  if (process.env.COWORKER_WEB_DIST) return process.env.COWORKER_WEB_DIST;
  const candidate = path.resolve(import.meta.dirname, "../../web/dist");
  return existsSync(candidate) ? candidate : null;
}

export interface DaemonStatus {
  running: boolean;
  pid: number | null;
  port: number | null;
}

export function daemonStatus(paths: CoworkerPaths = getPaths()): DaemonStatus {
  let pid: number | null = null;
  try {
    pid = Number.parseInt(readFileSync(paths.pidPath, "utf8").trim(), 10);
  } catch {
    pid = null;
  }
  if (pid == null || Number.isNaN(pid)) return { running: false, pid: null, port: null };

  let running = false;
  try {
    process.kill(pid, 0);
    running = true;
  } catch {
    running = false;
  }

  let port: number | null = null;
  try {
    port = Number.parseInt(readFileSync(paths.portPath, "utf8").trim(), 10);
    if (Number.isNaN(port)) port = null;
  } catch {
    port = null;
  }
  return { running, pid: running ? pid : null, port };
}

function removeIfOwned(file: string): void {
  try {
    const value = readFileSync(file, "utf8").trim();
    if (value === String(process.pid)) unlinkSync(file);
  } catch {
    // already gone
  }
}

export type { Logger } from "./logger.js";
export { createLogger } from "./logger.js";
export { Scheduler } from "./scheduler.js";
export { buildServer } from "./server.js";
export { resolveSession, syncCodexThreads } from "./sync.js";
