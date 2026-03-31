import type { LogLevel } from "./types.js";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function write(level: LogLevel, module: string, message: string, data?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  const entry = {
    ts: formatTimestamp(),
    level,
    module,
    msg: message,
    ...data,
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

export function createLogger(module: string): Logger {
  return {
    debug: (msg, data) => write("debug", module, msg, data),
    info: (msg, data) => write("info", module, msg, data),
    warn: (msg, data) => write("warn", module, msg, data),
    error: (msg, data) => write("error", module, msg, data),
  };
}
