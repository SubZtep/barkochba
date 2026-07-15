import pino from "pino"

// Sync file destination (not a worker-thread transport: those are
// unreliable under Bun, and sync writes survive process.exit).
const destination = pino.destination({
  dest: "/home/dcr/Code/barkochba/pino.log",
  sync: true
})

export const log = pino(destination)
