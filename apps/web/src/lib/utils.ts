import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatTime(value: number | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  const now = Date.now();
  const diffSec = Math.round((now - value) / 1000);
  if (diffSec >= 0 && diffSec < 60) return "just now";
  if (diffSec >= 0 && diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec >= 0 && diffSec < 86_400) return `${Math.floor(diffSec / 3600)}h ago`;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDuration(start: number | null, end: number | null): string {
  if (!start) return "—";
  const ms = (end ?? Date.now()) - start;
  if (ms < 1000) return "<1s";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

export function basename(path: string | null): string {
  if (!path) return "";
  return path.replace(/\/+$/, "").split("/").at(-1) ?? path;
}

export function truncate(value: string, max = 160): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
