// One-time (resumable) seeding of the Hungarian slang dictionary into
// brain.sqlite. Safe to re-run: already-embedded entries are skipped.

import { seedSlang } from "./lib/slang"

await seedSlang()
process.exit()
