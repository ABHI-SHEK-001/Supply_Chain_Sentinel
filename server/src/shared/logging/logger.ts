type Level = "debug" | "info" | "warn" | "error";

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let minLevel: Level = process.env["NODE_ENV"] === "test" ? "error" : "info";

export function setLogLevel(level: Level): void {
  minLevel = level;
}

function log(level: Level, msg: string, meta?: Record<string, unknown>): void {
  if (order[level] < order[minLevel]) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...meta });
  if (level === "error") console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => log("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => log("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log("error", msg, meta),
};