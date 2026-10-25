type Level = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export function createLogger(verbose = false): Logger {
  const log = (level: Level, message: string, fields?: Record<string, unknown>) => {
    if (level === "debug" && !verbose) return;
    const suffix = fields && Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : "";
    const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
    stream.write(`${new Date().toISOString()} ${level.toUpperCase()} ${message}${suffix}\n`);
  };
  return {
    debug: (message, fields) => log("debug", message, fields),
    info: (message, fields) => log("info", message, fields),
    warn: (message, fields) => log("warn", message, fields),
    error: (message, fields) => log("error", message, fields),
  };
}
