import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRunners, getPaths, loadConfig, readAllCodexThreads } from "@coworker/adapters";
import { daemonStatus } from "@coworker/daemon";
import { daemonReachable, daemonTarget } from "./http.js";

const execFileAsync = promisify(execFile);

export interface DoctorReport {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
}

export async function runDoctor(home?: string): Promise<DoctorReport> {
  const checks: DoctorReport["checks"] = [];
  const paths = getPaths(home);

  checks.push({
    name: "node",
    ok: Number(process.versions.node.split(".")[0]) >= 22,
    detail: `v${process.versions.node}`,
  });

  try {
    const { stdout } = await execFileAsync("git", ["--version"]);
    checks.push({ name: "git", ok: true, detail: stdout.trim() });
  } catch {
    checks.push({ name: "git", ok: false, detail: "git not found on PATH" });
  }

  try {
    const runners = createRunners(loadConfig(paths));
    for (const [id, runner] of Object.entries(runners)) {
      if (id === "fake") continue;
      const available = await runner.isAvailable();
      checks.push({
        name: `worker:${id}`,
        ok: available,
        detail: available ? "available" : "not found on PATH",
      });
    }
  } catch (error) {
    checks.push({
      name: "workers",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  const threads = readAllCodexThreads();
  checks.push({
    name: "codex sessions",
    ok: true,
    detail: `${threads.length} thread(s) discovered in ~/.codex`,
  });

  const status = daemonStatus(paths);
  checks.push({
    name: "daemon",
    ok: status.running,
    detail: status.running
      ? `pid ${status.pid} on port ${status.port}`
      : "not running (start it with `coworker start`)",
  });

  if (status.running) {
    const reachable = await daemonReachable(paths);
    checks.push({
      name: "api",
      ok: reachable,
      detail: reachable ? daemonTarget(paths).baseUrl : "daemon pid exists but API is unreachable",
    });
  } else {
    checks.push({ name: "api", ok: false, detail: "skipped (daemon not running)" });
  }

  return {
    ok: checks.every((check) => check.ok || check.name === "api"),
    checks,
  };
}
