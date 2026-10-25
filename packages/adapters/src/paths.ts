import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type CoworkerConfig, DEFAULT_CONFIG, mergeConfig } from "./config.js";

export interface CoworkerPaths {
  home: string;
  dbPath: string;
  configPath: string;
  tokenPath: string;
  pidPath: string;
  portPath: string;
  worktreesDir: string;
  logsDir: string;
}

export function coworkerHome(): string {
  return process.env.COWORKER_HOME ?? path.join(os.homedir(), ".coworker");
}

export function getPaths(home = coworkerHome()): CoworkerPaths {
  return {
    home,
    dbPath: path.join(home, "coworker.db"),
    configPath: path.join(home, "config.json"),
    tokenPath: path.join(home, "token"),
    pidPath: path.join(home, "daemon.pid"),
    portPath: path.join(home, "daemon.port"),
    worktreesDir: path.join(home, "worktrees"),
    logsDir: path.join(home, "logs"),
  };
}

export function ensureHome(paths: CoworkerPaths): CoworkerPaths {
  for (const dir of [paths.home, paths.worktreesDir, paths.logsDir]) {
    mkdirSync(dir, { recursive: true });
  }
  return paths;
}

export function loadConfig(paths: CoworkerPaths): CoworkerConfig {
  if (!existsSync(paths.configPath)) {
    return DEFAULT_CONFIG;
  }
  try {
    const raw = JSON.parse(readFileSync(paths.configPath, "utf8")) as Partial<CoworkerConfig>;
    return mergeConfig(DEFAULT_CONFIG, raw);
  } catch (error) {
    throw new Error(
      `Invalid config at ${paths.configPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function writeDefaultConfig(paths: CoworkerPaths): void {
  if (existsSync(paths.configPath)) return;
  writeFileSync(paths.configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, {
    mode: 0o600,
  });
}

export function ensureToken(paths: CoworkerPaths): string {
  if (existsSync(paths.tokenPath)) {
    const existing = readFileSync(paths.tokenPath, "utf8").trim();
    if (existing.length >= 32) return existing;
  }
  const token = randomBytes(32).toString("hex");
  writeFileSync(paths.tokenPath, `${token}\n`, { mode: 0o600 });
  return token;
}

export function readToken(paths: CoworkerPaths): string | null {
  if (!existsSync(paths.tokenPath)) return null;
  const token = readFileSync(paths.tokenPath, "utf8").trim();
  return token.length > 0 ? token : null;
}
