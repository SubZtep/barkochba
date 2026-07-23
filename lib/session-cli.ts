import { t } from "./i18n"
import { sessionToMermaid } from "./session-diagram"
import { listSessions, loadSessionRow } from "./session-store"

/**
 * Handles the `kaja session <list|diagram>` subcommand. Returns the text to
 * print and the exit code instead of printing/exiting itself, so tests can
 * call it directly. Deliberately built only on session-store — never on
 * tools/ or lib/agents.ts, which read the LLM config at import time;
 * browsing sessions must work without one.
 */
export async function runSessionCli(
  argv: string[]
): Promise<{ code: number; text: string }> {
  const [command, arg] = argv

  if (command === "list" && !arg) {
    const sessions = await listSessions()
    if (sessions.length === 0) return { code: 0, text: t("session.empty") }
    const idWidth = Math.max(...sessions.map((s) => `#${s.id}`.length))
    const personaWidth = Math.max(...sessions.map((s) => s.persona.length))
    const modelWidth = Math.max(...sessions.map((s) => s.model.length))
    return {
      code: 0,
      text: sessions
        .map((s) =>
          [
            `#${s.id}`.padEnd(idWidth),
            s.updatedAt.slice(0, 16).replace("T", " "),
            s.persona.padEnd(personaWidth),
            s.model.padEnd(modelWidth),
            s.title
          ].join("  ")
        )
        .join("\n")
    }
  }

  if (command === "diagram" && arg) {
    const id = Number.parseInt(arg, 10)
    const session = Number.isFinite(id) ? await loadSessionRow(id) : undefined
    if (!session) return { code: 1, text: t("session.notFound", { id: arg }) }
    return { code: 0, text: sessionToMermaid(session) }
  }

  return { code: 1, text: t("session.usage") }
}
