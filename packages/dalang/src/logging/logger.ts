// packages/dalang/src/logging/logger.ts
import pino from "pino";

export interface LoggerOptions {
  name: string;
  level: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
}

export type Logger = pino.Logger;

export function createLogger(opts: LoggerOptions): Logger {
  return pino({
    name: opts.name,
    level: opts.level,
    base: undefined, // do not include pid/hostname by default
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
