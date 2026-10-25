export class WorkerExecutionError extends Error {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    options: {
      exitCode?: number | null;
      timedOut?: boolean;
      details?: Record<string, unknown>;
    } = {},
  ) {
    super(message);
    this.name = "WorkerExecutionError";
    this.exitCode = options.exitCode ?? null;
    this.timedOut = options.timedOut ?? false;
    this.details = options.details;
  }
}

export function truncate(value: string, max = 8_000): string {
  return value.length > max ? `${value.slice(0, max)}\n…[truncated]` : value;
}
