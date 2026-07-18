import { color } from "bun"
import { render } from "ink"
import {
  config,
  configPath,
  create,
  isExists,
  readConfigLoose,
  validate
} from "./lib/config"
import { detectLanguage, setLanguage, t } from "./lib/i18n"
import { log } from "./lib/logger"
import { loadModels } from "./lib/models"

// The TUI owns the terminal: unless the user asked for a level explicitly,
// silence pino's info chatter (stt/tts progress lines go to stderr and would
// scribble over the Ink UI).
if (!process.env.LOG_LEVEL) log.level = "warn"

log.trace("Startup")

// i18n first: meow builds --help at module load, so the language must be set
// before the args import. Config wins; without one (or on first run) the
// system locale decides.
const loose = await readConfigLoose()
const lang = loose.settings?.language
setLanguage(lang === "hu" || lang === "en" ? lang : detectLanguage())

// Meow runs at module load (exits on --help/--version/--config). Before the
// config guard on purpose, so those flags work even with a missing or
// invalid config.
const { cli } = await import("./lib/args")

// Missing or invalid config (or --wizard): run the setup wizard instead of
// exiting, then fall through to the normal boot with the freshly written
// file. A fresh blank template never validates, so first-run also lands in
// the wizard.
if (!(await isExists())) await create()
if (cli.flags.wizard || !(await validate(true))) {
  const { runConfigWizard } = await import("./components/config-wizard")
  const outcome = await runConfigWizard(loose)
  if (outcome !== "saved") {
    console.log(t("cli.notSaved"))
    process.exit(0)
  }
  if (!(await validate())) {
    console.log(
      `${color("red", "ansi")}${t("cli.invalidConfig", { path: configPath })}`
    )
    process.exit(1)
  }
}

// Imported after the config guard: lib/openai.ts reads the config at module
// load (transitively, via lib/agents.ts), so a static import would crash
// before the first-run flow above.
const { default: App } = await import("./components/layout/app")
const { getDefaultTools } = await import("./tools")

const { settings, llm } = await config()
const models = await loadModels()
const tools = await getDefaultTools()
// Alternate screen: full-viewport app (header / chat / input). Restores the
// primary buffer on exit; no terminal scrollback while running.
// Kitty keyboard (auto): so Shift+Enter is distinct from Enter — plain TTYs
// send the same `\r` for both and cannot do Shift+Enter newlines otherwise.
const { waitUntilExit } = render(
  <App
    initialSettings={settings}
    models={models}
    openaiApiModel={llm.model}
    tools={tools}
  />,
  {
    alternateScreen: true,
    kittyKeyboard: {
      mode: "auto",
      flags: ["disambiguateEscapeCodes"]
    }
  }
)
await waitUntilExit()

console.log(t("cli.bye"))
process.exit(0)
