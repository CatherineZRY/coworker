import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { codexHome } from "./codex-state.js";

export interface HookInstallResult {
  path: string;
  changed: boolean;
  backupPath: string | null;
}

const COWORKER_HOOK_COMMAND = "coworker hook codex";

/**
 * Codex plugin-local hooks are not consistently executed yet, so `coworker
 * install` writes the global hooks file. The entries are idempotent and the
 * original file is backed up on first change.
 */
export function installCodexHooks(
  home = codexHome(),
  command = COWORKER_HOOK_COMMAND,
): HookInstallResult {
  mkdirSync(home, { recursive: true });
  const hooksPath = path.join(home, "hooks.json");
  const existing = readJson(hooksPath);
  const before = JSON.stringify(existing);
  const hooks = (existing.hooks ?? {}) as Record<string, unknown>;

  for (const event of ["SessionStart", "Stop", "SessionEnd"] as const) {
    const entries = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    const alreadyInstalled = entries.some((entry) => entryContains(entry, "hook codex"));
    if (alreadyInstalled) {
      for (const entry of entries) replaceHookCommand(entry, command);
    } else {
      entries.push({
        hooks: [
          {
            type: "command",
            command,
            timeout: 10,
          },
        ],
      });
    }
    hooks[event] = entries;
  }

  existing.hooks = hooks;
  const after = JSON.stringify(existing);
  if (after === before) {
    return { path: hooksPath, changed: false, backupPath: null };
  }

  let backupPath: string | null = null;
  if (existsSync(hooksPath)) {
    backupPath = `${hooksPath}.coworker-backup-${Date.now()}`;
    renameSync(hooksPath, backupPath);
  }
  writeFileSync(hooksPath, `${JSON.stringify(existing, null, 2)}\n`, { mode: 0o600 });
  return { path: hooksPath, changed: true, backupPath };
}

function readJson(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function entryContains(entry: unknown, needle: string): boolean {
  if (!entry || typeof entry !== "object") return false;
  return JSON.stringify(entry).includes(needle);
}

/** Keep an earlier install pointed at the current CLI and home directory. */
function replaceHookCommand(value: unknown, command: string): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "command" && typeof child === "string" && child.includes("hook codex")) {
      (value as Record<string, unknown>)[key] = command;
    } else if (child && typeof child === "object") {
      replaceHookCommand(child, command);
    }
  }
}
