import { readFileSync } from "node:fs";
import { type CoworkerPaths, getPaths, readToken } from "@coworker/adapters";

export interface DaemonTarget {
  baseUrl: string;
  token: string | null;
}

export function daemonTarget(paths: CoworkerPaths = getPaths()): DaemonTarget {
  let port = 7788;
  try {
    const parsed = Number.parseInt(readFileSync(paths.portPath, "utf8").trim(), 10);
    if (!Number.isNaN(parsed)) port = parsed;
  } catch {
    // fall back to default port
  }
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    token: readToken(paths),
  };
}

export async function apiFetch(
  pathname: string,
  init: RequestInit = {},
  paths: CoworkerPaths = getPaths(),
): Promise<Response> {
  const target = daemonTarget(paths);
  const headers = new Headers(init.headers);
  if (target.token) headers.set("Authorization", `Bearer ${target.token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(`${target.baseUrl}${pathname}`, { ...init, headers });
}

export async function apiJson<T>(
  pathname: string,
  init: RequestInit = {},
  paths: CoworkerPaths = getPaths(),
): Promise<T> {
  const response = await apiFetch(pathname, init, paths);
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      const parsed = JSON.parse(text) as { message?: string; error?: string };
      message = parsed.message ?? parsed.error ?? text;
    } catch {
      // keep raw text
    }
    throw new Error(`coworker API ${response.status}: ${message}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function daemonReachable(paths: CoworkerPaths = getPaths()): Promise<boolean> {
  const target = daemonTarget(paths);
  try {
    const response = await fetch(`${target.baseUrl}/api/health`, {
      signal: AbortSignal.timeout(1_500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export class DaemonNotRunningError extends Error {
  constructor() {
    super("coworker daemon is not running. Start it with `coworker start`.");
    this.name = "DaemonNotRunningError";
  }
}
