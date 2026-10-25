import { spawn } from "node:child_process";

export interface CommandSpec {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  input?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  onSpawn?: (pid: number | null) => void;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
}

export interface CommandResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  aborted: boolean;
}

const MAX_LINE_CHARS = 1_000_000;

export function runCommand(spec: CommandSpec): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });

    let timedOut = false;
    let aborted = false;
    let settled = false;

    const stdout = lineSplitter((line) => spec.onStdoutLine?.(line));
    const stderr = lineSplitter((line) => spec.onStderrLine?.(line));

    const killTree = (signal: NodeJS.Signals) => {
      if (child.pid == null) return;
      try {
        if (process.platform === "win32") child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          // already gone
        }
      }
    };

    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      spec.signal?.removeEventListener("abort", onAbort);
      stdout.flush();
      stderr.flush();
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree("SIGTERM");
      setTimeout(() => killTree("SIGKILL"), 5_000).unref();
    }, spec.timeoutMs);

    const onAbort = () => {
      aborted = true;
      killTree("SIGTERM");
      setTimeout(() => killTree("SIGKILL"), 5_000).unref();
    };

    if (spec.signal?.aborted) onAbort();
    else spec.signal?.addEventListener("abort", onAbort, { once: true });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      spec.signal?.removeEventListener("abort", onAbort);
      reject(error);
    });

    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk.toString("utf8")));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk.toString("utf8")));

    child.on("close", (code, signal) => {
      finish({ code, signal, timedOut, aborted });
    });

    spec.onSpawn?.(child.pid ?? null);

    if (child.stdin) {
      if (spec.input !== undefined) child.stdin.end(spec.input);
      else child.stdin.end();
    }
  });
}

function lineSplitter(onLine: (line: string) => void) {
  let buffer = "";
  return {
    push(chunk: string) {
      buffer += chunk;
      for (;;) {
        const index = buffer.indexOf("\n");
        if (index === -1) break;
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (line.length > 0) onLine(line);
      }
      if (buffer.length > MAX_LINE_CHARS) {
        onLine(buffer.slice(0, MAX_LINE_CHARS));
        buffer = "";
      }
    },
    flush() {
      if (buffer.length > 0) {
        onLine(buffer);
        buffer = "";
      }
    },
  };
}

export function commandExists(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, ["--version"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}
