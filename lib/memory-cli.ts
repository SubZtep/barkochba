import { t } from "./i18n"
import { forgetNotes, loadMemory, noteHeader, saveMemory } from "./memory-store"

/**
 * Handles the `kaja memory <list|forget|export>` subcommand. Returns the
 * text to print and the exit code instead of printing/exiting itself, so
 * tests can call it directly. Deliberately built only on memory-store —
 * never on tools/ or lib/agents.ts, which read the LLM config at import
 * time; managing memory must work without one.
 */
export async function runMemoryCli(
  argv: string[]
): Promise<{ code: number; text: string }> {
  const [command, arg] = argv

  if (command === "list" && !arg) {
    const store = await loadMemory()
    const entries = Object.entries(store)
    if (entries.length === 0) return { code: 0, text: t("memory.empty") }
    return {
      code: 0,
      text: entries
        .map(([key, note]) => `${noteHeader(key, note)}\n  ${note.content}`)
        .join("\n")
    }
  }

  if (command === "forget" && arg) {
    const store = await loadMemory()
    const victims = forgetNotes(
      store,
      arg.includes("*") ? { pattern: arg } : { key: arg }
    )
    if (victims.length === 0) return { code: 1, text: t("memory.noMatch") }
    await saveMemory(store)
    return { code: 0, text: t("memory.forgot", { keys: victims.join(", ") }) }
  }

  if (command === "export" && !arg) {
    const store = await loadMemory()
    if (Object.keys(store).length === 0) return { code: 0, text: "{}" }
    return { code: 0, text: JSON.stringify(store, null, 2) }
  }

  return { code: 1, text: t("memory.usage") }
}
