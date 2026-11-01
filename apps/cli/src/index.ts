#!/usr/bin/env node
import { spawn } from "node:child_process";
import { closeSync, openSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type CoworkerPaths,
  ensureHome,
  ensureToken,
  getPaths,
  loadConfig,
  readToken,
  writeDefaultConfig,
} from "@coworker/adapters";
import { daemonStatus, repairSessionBoard, startDaemon } from "@coworker/daemon";
import { Command } from "commander";
import { openBrowser } from "./browser.js";
import { runDoctor } from "./doctor.js";
import { apiFetch, apiJson, daemonReachable, daemonTarget } from "./http.js";
import { installIntegration } from "./install.js";
import { runMcpServer } from "./mcp.js";

const VERSION = "0.1.0";

const program = new Command();
program
  .name("coworker")
  .description("Local-first orchestration board for Codex and worker coding agents")
  .version(VERSION)
  .showHelpAfterError();

program
  .command("start")
  .description("Start the local daemon and open the board")
  .option("-p, --port <port>", "port to listen on", (value) => Number.parseInt(value, 10))
  .option("--host <host>", "host to bind (127.0.0.1 by default)")
  .option("--home <dir>", "coworker home directory")
  .option("--no-open", "do not open the browser")
  .option("--detach", "run the daemon in the background")
  .option("--verbose", "verbose logging")
  .action(async (options) => {
    const paths = ensureHome(getPaths(options.home));
    const existing = daemonStatus(paths);
    if (existing.running) {
      const url = boardUrl(paths);
      console.log(`coworker is already running (pid ${existing.pid})`);
      console.log(`Board: ${url}`);
      if (options.open !== false)
        openBrowser(`${url}?token=${encodeURIComponent(readToken(paths) ?? "")}`);
      return;
    }

    if (options.detach) {
      await startDetached(paths, { ...options, open: options.open !== false });
      return;
    }

    const handle = await startDaemon({
      home: paths.home,
      port: options.port,
      host: options.host,
      verbose: options.verbose,
    });
    console.log(`coworker ${VERSION} is running`);
    console.log(`Board: ${handle.url}`);
    console.log(`Authenticated URL: ${handle.openUrl}`);
    console.log("Press Ctrl+C to stop.");
    if (options.open !== false) openBrowser(handle.openUrl);

    const shutdown = async (signal: string) => {
      console.log(`\nStopping coworker (${signal})…`);
      await handle.close();
      process.exit(0);
    };
    process.once("SIGINT", () => void shutdown("SIGINT"));
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
  });

program
  .command("stop")
  .description("Stop the coworker daemon")
  .option("--home <dir>", "coworker home directory")
  .action(async (options) => {
    const paths = getPaths(options.home);
    const status = daemonStatus(paths);
    if (!status.running || status.pid == null) {
      console.log("coworker is not running.");
      removeStaleFiles(paths);
      return;
    }
    process.kill(status.pid, "SIGTERM");
    const stopped = await waitForExit(status.pid, 5_000);
    if (!stopped) {
      try {
        process.kill(status.pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
    removeStaleFiles(paths);
    console.log(`Stopped coworker (pid ${status.pid}).`);
  });

program
  .command("status")
  .description("Show daemon status")
  .option("--home <dir>", "coworker home directory")
  .action(async (options) => {
    const paths = getPaths(options.home);
    const status = daemonStatus(paths);
    if (!status.running) {
      console.log("coworker: stopped");
      return;
    }
    console.log(`coworker: running (pid ${status.pid}, port ${status.port ?? "?"})`);
    try {
      const health = await apiJson<{ version: string; uptimeSec: number; activeRuns: number }>(
        "/api/health",
        {},
        paths,
      );
      console.log(
        `version ${health.version} · uptime ${health.uptimeSec}s · active runs ${health.activeRuns}`,
      );
      console.log(`Board: ${boardUrl(paths)}`);
      console.log("Run `coworker open` to open the authenticated board.");
    } catch (error) {
      console.log(`API unreachable: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  });

program
  .command("open")
  .description("Open the board in your browser")
  .option("--home <dir>", "coworker home directory")
  .action(async (options) => {
    const paths = getPaths(options.home);
    if (!(await daemonReachable(paths))) {
      console.error("coworker is not running. Start it with `coworker start`.");
      process.exitCode = 1;
      return;
    }
    const token = readToken(paths);
    if (!token) {
      console.error("No coworker token found. Run `coworker install` or restart the daemon.");
      process.exitCode = 1;
      return;
    }
    const url = `${boardUrl(paths)}?token=${encodeURIComponent(token)}`;
    openBrowser(url);
    console.log(`Opened ${boardUrl(paths)}`);
  });

program
  .command("install")
  .description("Install the Codex plugin, MCP server, and hooks")
  .option("--home <dir>", "coworker home directory")
  .option("--skip-hooks", "do not modify ~/.codex/hooks.json")
  .option("--skip-mcp", "do not add the MCP server to ~/.codex/config.toml")
  .option("--skip-plugin", "do not install the local Codex plugin marketplace")
  .action(async (options) => {
    const result = await installIntegration({
      home: options.home,
      skipHooks: options.skipHooks,
      skipMcp: options.skipMcp,
      skipPlugin: options.skipPlugin,
    });
    console.log(`coworker home: ${result.home}`);
    console.log(`token: ${result.tokenPath}`);
    if (result.hooks) {
      console.log(
        result.hooks.changed
          ? `Codex hooks: installed in ${result.hooks.path}` +
              (result.hooks.backupPath ? ` (backup: ${result.hooks.backupPath})` : "")
          : `Codex hooks: already installed in ${result.hooks.path}`,
      );
    }
    console.log(
      result.mcpChanged
        ? `Codex MCP: added [mcp_servers.coworker] to ${result.mcpConfigPath}`
        : `Codex MCP: already configured in ${result.mcpConfigPath}`,
    );
    if (result.plugin) {
      console.log(
        result.plugin.configChanged
          ? `Codex plugin: registered coworker@coworker-local (${result.plugin.marketplacePath})`
          : `Codex plugin: already registered (${result.plugin.marketplacePath})`,
      );
    } else {
      console.log(
        "Codex plugin: not found in this build; the MCP server and skill can still be used directly.",
      );
    }
    console.log(`MCP command: ${result.mcpCommand} ${result.mcpArgs.join(" ")}`);
    console.log("");
    console.log("Next:");
    console.log("  1. Start the daemon: coworker start");
    console.log("  2. Restart Codex so it picks up the MCP server and plugin.");
    console.log("  3. In Codex, enable the coworker plugin and ask it to delegate a task.");
  });

program
  .command("doctor")
  .description("Check the local environment")
  .option("--home <dir>", "coworker home directory")
  .action(async (options) => {
    const report = await runDoctor(options.home);
    for (const check of report.checks) {
      console.log(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`);
    }
    if (!report.ok) process.exitCode = 1;
  });

program
  .command("repair-session-board <boardId> <threadId>")
  .description("Rebind an internal board to a primary session without restarting workers")
  .option("--pin-title", "pin the display name while a legacy daemon is still running")
  .option("--home <dir>", "coworker home directory")
  .action(async (boardId, threadId, options) => {
    const { board, backupPath } = await repairSessionBoard({
      home: options.home,
      boardId,
      targetThreadId: threadId,
      pinTitle: options.pinTitle,
    });
    console.log(`Repaired board ${board.id}: ${board.title}`);
    console.log(`SQLite backup: ${backupPath}`);
    console.log("Task/run/event IDs and worktrees were preserved; daemon was not restarted.");
  });

program
  .command("config")
  .description("Print the coworker config")
  .option("--home <dir>", "coworker home directory")
  .action((options) => {
    const paths = ensureHome(getPaths(options.home));
    writeDefaultConfig(paths);
    console.log(`Config: ${paths.configPath}`);
    console.log(JSON.stringify(loadConfig(paths), null, 2));
  });

program
  .command("hook <target>")
  .description("Internal: receive a Codex lifecycle hook")
  .option("--home <dir>", "coworker home directory")
  .action(async (target, options) => {
    if (target !== "codex") return;
    const paths = getPaths(options.home);
    const raw = await readStdin();
    let payload: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(raw || "{}") as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      payload = {};
    }
    try {
      await apiFetch(
        "/api/hooks/codex",
        {
          method: "POST",
          body: JSON.stringify({
            ...payload,
            ppid: process.ppid,
            cwd: typeof payload.cwd === "string" ? payload.cwd : process.cwd(),
          }),
          signal: AbortSignal.timeout(3_000),
        },
        paths,
      );
    } catch {
      // Hooks must never block Codex; the daemon may be stopped.
    }
    process.exit(0);
  });

program
  .command("mcp")
  .description("Run the coworker MCP server over stdio")
  .action(async () => {
    await runMcpServer();
  });

program
  .command("__serve", { hidden: true })
  .description("Internal: run the daemon without opening a browser")
  .option("-p, --port <port>", "port", (value) => Number.parseInt(value, 10))
  .option("--host <host>", "host")
  .option("--home <dir>", "coworker home directory")
  .option("--verbose", "verbose logging")
  .action(async (options) => {
    const handle = await startDaemon({
      home: options.home,
      port: options.port,
      host: options.host,
      verbose: options.verbose,
    });
    console.log(`coworker ready at ${handle.url}`);
    const shutdown = async () => {
      await handle.close();
      process.exit(0);
    };
    process.once("SIGINT", () => void shutdown());
    process.once("SIGTERM", () => void shutdown());
  });

program.parseAsync(process.argv).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`coworker: ${message}`);
  process.exit(1);
});

function boardUrl(paths: CoworkerPaths): string {
  const target = daemonTarget(paths);
  return target.baseUrl;
}

async function startDetached(
  paths: CoworkerPaths,
  options: { port?: number; host?: string; verbose?: boolean; open?: boolean },
): Promise<void> {
  ensureToken(paths);
  const entry = fileURLToPath(import.meta.url);
  const args = entry.endsWith(".ts") ? ["--import", "tsx", entry] : [entry];
  args.push("__serve");
  if (options.port != null) args.push("--port", String(options.port));
  if (options.host) args.push("--host", options.host);
  args.push("--home", paths.home);
  if (options.verbose) args.push("--verbose");

  const logPath = path.join(paths.logsDir, "daemon.log");
  const logFd = openSync(logPath, "a");
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env },
  });
  closeSync(logFd);
  child.unref();

  for (let i = 0; i < 40; i += 1) {
    if (await daemonReachable(paths)) {
      const url = boardUrl(paths);
      console.log(`coworker started in the background (pid ${child.pid})`);
      console.log(`Board: ${url}`);
      console.log(`Logs: ${logPath}`);
      if (options.open !== false) {
        const token = readToken(paths);
        openBrowser(`${url}?token=${encodeURIComponent(token ?? "")}`);
      }
      return;
    }
    await delay(250);
  }
  console.error(`coworker did not start. Check ${logPath}`);
  process.exitCode = 1;
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await delay(100);
  }
  return false;
}

function removeStaleFiles(paths: CoworkerPaths): void {
  for (const file of [paths.pidPath, paths.portPath]) {
    try {
      unlinkSync(file);
    } catch {
      // already gone
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
