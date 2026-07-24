import { color } from "bun"
import { render } from "ink"
import { InkPictureProvider } from "ink-picture"
import {
  config,
  create,
  getConfigPath,
  isExists,
  readConfigLoose,
  validate
} from "./lib/config"
import { detectLanguage, setLanguage, t } from "./lib/i18n"
import { log } from "./lib/logger"
import { loadModels } from "./lib/models"
import { loadPersonas } from "./lib/personas"

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

// Session subcommand: same deal — browsing past sessions must work even
// with a missing or invalid LLM config.
if (cli.input[0] === "session") {
  const { runSessionCli } = await import("./lib/session-cli")
  const { code, text } = await runSessionCli(cli.input.slice(1))
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
      `${color("red", "ansi")}${t("cli.invalidConfig", { path: getConfigPath() })}`
    )
    process.exit(1)
  }
}

// Imported after the config guard: lib/openai.ts reads the config at module
// load (transitively, via lib/agents.ts), so a static import would crash
// before the first-run flow above.
const { default: App } = await import("./components/layout/app")
const { getDefaultTools } = await import("./tools")
const {
  listSessions,
  loadLatestSessionRow,
  loadPromptHistory,
  loadSessionRow
} = await import("./lib/session-store")
const { loadMemory } = await import("./lib/memory-store")

// --continue resumes the most recent session, --session <id> a specific
// one; either way the restored conversation is handed to App as a prop.
let initialSession: import("./schemas/session").PersistedSession | undefined
if (cli.flags.continue) {
  initialSession = await loadLatestSessionRow()
  if (!initialSession) {
    console.log(t("session.none"))
    process.exit(1)
  }
} else if (cli.flags.session) {
  const sessionId = Number.parseInt(cli.flags.session, 10)
  initialSession = Number.isFinite(sessionId)
    ? await loadSessionRow(sessionId)
    : undefined
  if (!initialSession) {
    console.log(t("session.notFound", { id: cli.flags.session }))
    process.exit(1)
  }
}
const promptHistory = await loadPromptHistory()

const { settings, llm } = await config()
const models = await loadModels()
const personas = await loadPersonas()
const { tools, closeTools } = await getDefaultTools()
const sessionCount = (await listSessions()).length
const memoryNoteCount = Object.keys(await loadMemory()).length
// Closes any long-lived tool connection (e.g. the Playwright MCP subprocess)
// so it isn't left orphaned; guarded so SIGINT and the normal exit path
// below can't both try to close it.
let closed = false
const shutdown = async () => {
  if (closed) return
  closed = true
  await closeTools()
}
process.on("SIGINT", async () => {
  await shutdown()
  process.exit(0)
})
process.on("SIGTERM", async () => {
  await shutdown()
  process.exit(0)
})

// Alternate screen: full-viewport app (header / chat / input). Restores the
// primary buffer on exit; no terminal scrollback while running.
// Kitty keyboard (auto): so Shift+Enter is distinct from Enter — plain TTYs
// send the same `\r` for both and cannot do Shift+Enter newlines otherwise.
const { waitUntilExit } = render(
  <InkPictureProvider>
    <App
      initialSettings={settings}
      models={models}
      personas={personas}
      openaiApiModel={llm.model}
      tools={tools}
      initialSession={initialSession}
      promptHistory={promptHistory}
      sessionCount={sessionCount}
      memoryNoteCount={memoryNoteCount}
    />
  </InkPictureProvider>,
  {
    alternateScreen: true,
    kittyKeyboard: {
      mode: "auto",
      flags: ["disambiguateEscapeCodes"]
    }
  }
)
await waitUntilExit()
await shutdown()

console.log(t("cli.bye"))
process.exit(0)
