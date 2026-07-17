import { color } from "bun"
import { render } from "ink"
import { config, configPath, create, isExists, validate } from "./lib/config"
import { log } from "./lib/logger"
import { loadModels } from "./lib/models"

// The TUI owns the terminal: unless the user asked for a level explicitly,
// silence pino's info chatter (stt/tts progress lines go to stderr and would
// scribble over the Ink UI).
if (!process.env.LOG_LEVEL) log.level = "warn"

if (!(await isExists())) {
  await create()
  console.log(`${color("red", "ansi")}Config file created. Please populate:`)
  console.log(`${color("yellow", "ansi")}${configPath}`)
  process.exit(0)
} else if (!(await validate())) {
  console.log(`${color("red", "ansi")}Invalid config file: ${configPath}`)
  process.exit(1)
}

// Imported after the config guard: lib/openai.ts reads the config at module
// load, so a static import would crash before the first-run flow above.
const { default: App } = await import("./components/app")

// Also imported dynamically: meow runs at module load (it exits on
// --help/--version/--config), and it must not fire before the first-run
// flow above.
const { cli } = await import("./lib/args")

const { settings } = await config()
const models = await loadModels()
// Alternate screen: full-viewport app (header / chat / input). Restores the
// primary buffer on exit; no terminal scrollback while running.
const { waitUntilExit } = render(
  <App initialSettings={settings} models={models} />,
  { alternateScreen: true }
)
await waitUntilExit()

console.log("Bye, bye!")
process.exit(0)
