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

// Memory subcommand: before the config guard on purpose — browsing and
// managing memory must work even with a missing or invalid LLM config.
if (cli.input[0] === "memory") {
  const { runMemoryCli } = await import("./lib/memory-cli")
  const { code, text } = await runMemoryCli(cli.input.slice(1))
  console.log(text)
  process.exit(code)
}

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
// render()'s own clear() isn't available until after it returns, but App
// needs it (to force a full repaint after a mouse-wheel scroll — some
// terminals drift out of sync with Ink's diffed frames on tall content).
// A ref populated right after render() closes that loop.
const clearRef: { current?: () => void } = {}
// Alternate screen: full-viewport app (header / chat / input). Restores the
// primary buffer on exit; no terminal scrollback while running.
// Kitty keyboard (auto): so Shift+Enter is distinct from Enter — plain TTYs
// send the same `\r` for both and cannot do Shift+Enter newlines otherwise.
const { waitUntilExit, clear } = render(
  <App
    initialSettings={settings}
    models={models}
    openaiApiModel={llm.model}
    tools={tools}
    clearRef={clearRef}
  />,
  {
    alternateScreen: true,
    kittyKeyboard: {
      mode: "auto",
      flags: ["disambiguateEscapeCodes"]
    }
  }
)
clearRef.current = clear
await waitUntilExit()

console.log(t("cli.bye"))
process.exit(0)
