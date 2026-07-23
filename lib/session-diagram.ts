import type { PersistedSession } from "../schemas/session"

/**
 * Renders a persisted session's timeline as a mermaid sequence diagram:
 * User and Kaja as lanes, plus one lane per tool that was called. Works
 * straight off the stored TimelineEvent[] — the events are already the
 * presentation-level sequence, so no message parsing is needed. Fields are
 * read defensively (the events come from database JSON, typed loosely).
 */

const LABEL_MAX = 60

/** One-line, length-capped, mermaid-safe message text. */
function label(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "")
  const flat = text.replace(/\s+/g, " ").trim()
  const cut =
    flat.length > LABEL_MAX ? `${flat.slice(0, LABEL_MAX - 1)}…` : flat
  // Single pass: "#" → "#35;" introduces ";", so sequential replaces
  // would mangle their own output.
  return cut.replace(/[#;]/g, (char) => (char === "#" ? "#35;" : "#59;"))
}

/** Tool names become mermaid participant ids — keep them word-safe. */
function participant(name: string): string {
  return name.replace(/\W/g, "_")
}

export function sessionToMermaid(session: PersistedSession): string {
  const events = session.events

  const tools: string[] = []
  for (const event of events) {
    if (event.type !== "tool_call" || typeof event.name !== "string") continue
    const id = participant(event.name)
    if (!tools.includes(id)) tools.push(id)
  }

  const lines = ["sequenceDiagram", "  actor User", "  participant Kaja"]
  for (const tool of tools) lines.push(`  participant ${tool}`)
  lines.push("")

  for (const event of events) {
    switch (event.type) {
      case "user":
        lines.push(`  User->>Kaja: ${label(event.text)}`)
        break
      case "reasoning":
        lines.push("  Note over Kaja: thinking…")
        break
      case "tool_call":
        if (typeof event.name === "string")
          lines.push(
            `  Kaja->>${participant(event.name)}: ${label(event.arguments)}`
          )
        break
      case "ask_user":
        lines.push(`  Kaja-->>User: ${label(event.question)}`)
        break
      case "confirm_command":
        lines.push(`  Kaja-->>User: $ ${label(event.command)}`)
        break
      case "message":
      case "final":
        if (typeof event.content === "string" && event.content)
          lines.push(`  Kaja-->>User: ${label(event.content)}`)
        break
      case "error":
        lines.push(`  Kaja--xUser: ${label(event.text)}`)
        break
    }
  }

  return lines.join("\n")
}
