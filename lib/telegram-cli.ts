import type { KajaConfig } from "../schemas/config"
import type { ResolvedModel } from "../schemas/models"
import type { Tool } from "./agents"
import { t } from "./i18n"
import type { Persona } from "./personas"

/**
 * Runs the `kaja telegram` subcommand: a long-polling Telegram bot reusing
 * the same tools/personas/models the terminal app was given. Unlike
 * lib/memory-cli.ts/lib/session-cli.ts, this needs a real Agent to answer
 * messages, so it's dispatched (from cli.tsx) after the config guard and
 * default-tools loading, not before. Returns an exit code instead of calling
 * process.exit itself, so tests can call it directly; resolves only once
 * the bot has been gracefully stopped (SIGINT/SIGTERM), matching the "run
 * until killed" shape of the command.
 */
export async function runTelegramCli(deps: {
  config: KajaConfig
  tools: Tool<any>[]
  personas: Persona[]
  models: ResolvedModel[]
}): Promise<number> {
  const { telegram } = deps.config
  if (!telegram) {
    console.log(t("telegram.notConfigured"))
    return 1
  }

  const { createTelegramBot } = await import("./telegram-bot")
  const bot = createTelegramBot({
    ...telegram,
    agentConfig: { model: deps.config.llm.model, tools: deps.tools },
    personas: deps.personas,
    models: deps.models
  })

  // Owns its own SIGINT/SIGTERM handling for bot.stop() rather than teaching
  // cli.tsx's shared shutdown() about grammy — those signals also still
  // reach cli.tsx's own handlers (closeTools() etc.) unchanged.
  const onSignal = () => {
    bot.stop().catch(() => {})
  }
  process.on("SIGINT", onSignal)
  process.on("SIGTERM", onSignal)

  console.log(t("telegram.starting"))
  try {
    await bot.start()
    return 0
  } catch (error) {
    console.log(error instanceof Error ? error.message : String(error))
    return 1
  } finally {
    process.off("SIGINT", onSignal)
    process.off("SIGTERM", onSignal)
  }
}
