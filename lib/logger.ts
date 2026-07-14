import pino from "pino"
import pretty from "pino-pretty"

// pino-pretty as a sync stream (not a transport: worker threads are
// unreliable under Bun, and sync writes survive process.exit).
export const log = pino(
  {
    level: process.env.LOG_LEVEL ?? "info",
    base: undefined
  },
  pretty({
    ignore: "pid,hostname",
    translateTime: "SYS:HH:MM:ss.l",
    levelFirst: true,
    singleLine: true,
    colorize: true,
    destination: 2,
    sync: true
  })
)
