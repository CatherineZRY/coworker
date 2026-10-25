import { existsSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

export interface CodexThreadSnapshot {
  id: string;
  title: string | null;
  firstUserMessage: string | null;
  cwd: string;
  gitBranch: string | null;
  source: string | null;
  updatedAt: number | null;
  archived: boolean;
}

export function codexHome(): string {
  return process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
}

export function findCodexStateFiles(home = codexHome()): string[] {
  if (!existsSync(home)) return [];
  return readdirSync(home)
    .filter((name) => /^state_.*\.sqlite$/.test(name))
    .map((name) => path.join(home, name))
    .sort((a, b) => statMtime(b) - statMtime(a));
}

export function readCodexThreads(file: string): CodexThreadSnapshot[] {
  let db: Database.Database | null = null;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true, timeout: 2_000 });
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'threads'")
      .all() as Array<{ name: string }>;
    if (tables.length === 0) return [];

    const columns = new Set(
      (db.prepare("PRAGMA table_info(threads)").all() as Array<{ name: string }>).map(
        (column) => column.name,
      ),
    );
    const required = ["id", "cwd"];
    if (required.some((column) => !columns.has(column))) return [];

    const pick = (column: string, fallback: string) =>
      columns.has(column) ? column : `${fallback} AS ${column}`;
    const select = [
      "id",
      pick("title", "NULL"),
      pick("first_user_message", "NULL"),
      "cwd",
      pick("git_branch", "NULL"),
      pick("source", "NULL"),
      pick("updated_at", "NULL"),
      pick("archived", "0"),
    ].join(", ");

    const rows = db.prepare(`SELECT ${select} FROM threads`).all() as Array<{
      id: string;
      title: string | null;
      first_user_message: string | null;
      cwd: string | null;
      git_branch: string | null;
      source: string | null;
      updated_at: number | string | null;
      archived: number | boolean | null;
    }>;

    return rows
      .filter((row) => typeof row.id === "string" && row.id.length > 0 && row.cwd)
      .map((row) => ({
        id: row.id,
        title: normalizeString(row.title),
        firstUserMessage: normalizeString(row.first_user_message),
        cwd: row.cwd as string,
        gitBranch: normalizeString(row.git_branch),
        source: normalizeString(row.source) ?? "codex",
        updatedAt: normalizeTimestamp(row.updated_at),
        archived: row.archived === 1 || row.archived === true,
      }));
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

export function readAllCodexThreads(home = codexHome()): CodexThreadSnapshot[] {
  const byId = new Map<string, CodexThreadSnapshot>();
  for (const file of findCodexStateFiles(home)) {
    for (const thread of readCodexThreads(file)) {
      const existing = byId.get(thread.id);
      if (!existing || (thread.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
        byId.set(thread.id, thread);
      }
    }
  }
  return [...byId.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

function statMtime(file: string): number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizeTimestamp(value: number | string | null): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value < 10_000_000_000 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}
