import { mkdirSync } from "node:fs"
import { join } from "node:path"
import envPaths from "env-paths"
import pino from "pino"

// Injected at compile time by CI via `bun build --define PRODUCTION=...`
declare const PRODUCTION: boolean | undefined

const isProduction = typeof PRODUCTION !== "undefined" && PRODUCTION

const paths = envPaths("kaja", { suffix: "" })
const logPath = join(paths.cache, "kaja.log")
mkdirSync(paths.cache, { recursive: true })

export const log = pino(
  { level: isProduction ? "silent" : "trace" },
  // Sync file destination (not a worker-thread transport: those are
  // unreliable under Bun, and sync writes survive process.exit).
  pino.destination({ dest: logPath, sync: true })
)
