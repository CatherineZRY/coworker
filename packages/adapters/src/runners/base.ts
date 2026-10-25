import type { WorkerResult, WorkerRunInput } from "@coworker/core";
import type { WorktreeDiff } from "../git.js";

export interface RunnerContext {
  input: WorkerRunInput;
  sessionId: string | null;
  messages: string[];
  resultText: string | null;
  usage: Record<string, unknown> | null;
  errorText: string | null;
}

export function createContext(input: WorkerRunInput): RunnerContext {
  return {
    input,
    sessionId: null,
    messages: [],
    resultText: null,
    usage: null,
    errorText: null,
  };
}

export function pushMessage(ctx: RunnerContext, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  ctx.messages.push(trimmed);
  ctx.input.onEvent({
    type: "message",
    payload: { text: trimmed.slice(0, 8_000) },
  });
}

export function summarize(ctx: RunnerContext): string | null {
  const text = ctx.resultText?.trim() || ctx.messages.filter(Boolean).at(-1) || "";
  if (!text) return null;
  return text.length > 8_000 ? `${text.slice(0, 8_000)}\n…[truncated]` : text;
}

export function buildResult(ctx: RunnerContext, diff: WorktreeDiff): WorkerResult {
  return {
    summary: summarize(ctx),
    diffStat: diff.stat.trim() || null,
    diffPatch: diff.patch || null,
    headSha: diff.headSha,
    usage: ctx.usage,
    artifacts: [],
  };
}

export function parseJsonLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const record = block as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") parts.push(record.text);
  }
  return parts.join("\n");
}
