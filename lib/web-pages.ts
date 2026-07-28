import type { MemoryStore } from "../schemas/memory"
import type { Persona } from "../schemas/personas"
import type { PersistedSession, SessionMeta } from "../schemas/session"
import type { GameResult } from "./memory-store"

/**
 * Pure HTML renderers for the `kaja web` subcommand — data in, HTML string
 * out, no I/O and no server imports (the same "return text, don't print"
 * testability pattern as lib/memory-cli.ts). lib/web-cli.ts owns the routes
 * and feeds these from the stores.
 */

export function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

/**
 * Recursive display-only copy of the (loose, possibly invalid) config with
 * secret-looking values masked to their first four characters — the web UI
 * must never render a full API key or bot token into a page.
 */
export function maskSecrets(value: unknown, keyHint = ""): unknown {
  if (typeof value === "string" && /apikey|token/i.test(keyHint)) {
    return `${value.slice(0, 4)}…`
  }
  if (Array.isArray(value)) return value.map((item) => maskSecrets(item))
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        maskSecrets(child, key)
      ])
    )
  }
  return value
}

const TABS = [
  ["/", "Config"],
  ["/personas", "Personas"],
  ["/notes", "Notes"],
  ["/sessions", "Sessions"],
  ["/game", "Game"]
] as const

type Tab = (typeof TABS)[number][0]

const STYLE = `
  :root { color-scheme: light dark; }
  body {
    font-family: system-ui, sans-serif;
    margin: 0 auto; padding: 1rem 1.5rem; max-width: 72rem;
  }
  nav { display: flex; gap: 1rem; margin-bottom: 1.5rem; border-bottom: 1px solid light-dark(#ddd, #444); }
  nav a { padding: 0.5rem 0; text-decoration: none; color: inherit; opacity: 0.7; }
  nav a.active { opacity: 1; font-weight: 600; border-bottom: 2px solid currentColor; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; vertical-align: top; padding: 0.4rem 0.75rem 0.4rem 0; border-bottom: 1px solid light-dark(#eee, #333); }
  th { font-size: 0.8rem; text-transform: uppercase; opacity: 0.6; }
  pre { background: light-dark(#f5f5f5, #222); padding: 1rem; border-radius: 6px; overflow-x: auto; }
  code { font-size: 0.9em; }
  form { display: inline; }
  button { cursor: pointer; }
  details { margin: 1rem 0; }
  .meta { opacity: 0.6; font-size: 0.85rem; }
  .empty { opacity: 0.6; font-style: italic; }
`

export function layout(title: string, activeTab: Tab, body: string): string {
  const nav = TABS.map(
    ([href, label]) =>
      `<a href="${href}"${href === activeTab ? ' class="active"' : ""}>${label}</a>`
  ).join("")
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — Kaja</title>
<style>${STYLE}</style>
</head>
<body>
<nav>${nav}</nav>
${body}
</body>
</html>`
}

/** Per-row delete form; confirm() is the only client JS in the whole UI. */
function deleteForm(action: string, hidden: Record<string, string>): string {
  const inputs = Object.entries(hidden)
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`
    )
    .join("")
  return `<form method="post" action="${escapeHtml(action)}" onsubmit="return confirm('Delete?')">${inputs}<button>Delete</button></form>`
}

export function configPage(data: {
  config: unknown
  configPath: string
  dbPath: string
  counts: Record<string, number>
}): string {
  const counts = Object.entries(data.counts)
    .map(
      ([table, count]) =>
        `<tr><td><code>${escapeHtml(table)}</code></td><td>${count}</td></tr>`
    )
    .join("")
  return layout(
    "Config",
    "/",
    `<h1>Config</h1>
<p class="meta">config: <code>${escapeHtml(data.configPath)}</code><br>
memory db: <code>${escapeHtml(data.dbPath)}</code></p>
<pre><code>${escapeHtml(JSON.stringify(maskSecrets(data.config), null, 2))}</code></pre>
<h2>Tables</h2>
<table><thead><tr><th>Table</th><th>Rows</th></tr></thead><tbody>${counts}</tbody></table>`
  )
}

export function notesPage(store: MemoryStore): string {
  const entries = Object.entries(store)
  const rows = entries
    .map(([key, note]) => {
      const flags = note.sticky ? `${note.importance}, sticky` : note.importance
      return `<tr>
<td><code>${escapeHtml(key)}</code></td>
<td>${escapeHtml(note.content)}</td>
<td>${escapeHtml(flags)}</td>
<td>${escapeHtml(note.tags.join(", "))}</td>
<td>${note.useCount}</td>
<td>${escapeHtml(note.lastUsedAt.slice(0, 10))}</td>
<td>${deleteForm("/notes/delete", { key })}</td>
</tr>`
    })
    .join("")
  const body =
    entries.length === 0
      ? `<p class="empty">No notes.</p>`
      : `<table><thead><tr><th>Key</th><th>Content</th><th>Importance</th><th>Tags</th><th>Used</th><th>Last used</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
  return layout("Notes", "/notes", `<h1>Notes (${entries.length})</h1>${body}`)
}

export function personasPage(
  entries: { persona: Persona; systemPrompt: string | undefined }[]
): string {
  const sections = entries
    .map(({ persona, systemPrompt }) => {
      const promptBlock = systemPrompt
        ? `<pre><code>${escapeHtml(systemPrompt)}</code></pre>`
        : `<p class="empty">No system prompt (no instructions and no built-in tool contracts apply).</p>`
      return `<details open>
<summary>${escapeHtml(persona.label)} <code>${escapeHtml(persona.id)}</code></summary>
${promptBlock}
</details>`
    })
    .join("")
  const body =
    entries.length === 0 ? `<p class="empty">No personas.</p>` : sections
  return layout(
    "Personas",
    "/personas",
    `<h1>Personas (${entries.length})</h1>
<p class="meta">Generated system prompt per persona, as it would be sent on the first message of a new session (assumes the default toolset: ask_user, run_command, memory).</p>
${body}`
  )
}

export function unconfiguredPersonasPage(): string {
  return layout(
    "Personas",
    "/personas",
    `<h1>Personas</h1>
<p class="empty">No config.json yet — run the setup wizard (or \`kaja\`) once, then reload this page.</p>`
  )
}

export function sessionsPage(metas: SessionMeta[]): string {
  const rows = metas
    .map(
      (meta) => `<tr>
<td><a href="/sessions/${meta.id}">#${meta.id}</a></td>
<td><a href="/sessions/${meta.id}">${escapeHtml(meta.title)}</a></td>
<td>${escapeHtml(meta.persona)}</td>
<td>${escapeHtml(meta.model)}</td>
<td>${escapeHtml(meta.owner ?? "terminal")}</td>
<td>${escapeHtml(meta.updatedAt.slice(0, 16).replace("T", " "))}</td>
<td>${deleteForm(`/sessions/${meta.id}/delete`, {})}</td>
</tr>`
    )
    .join("")
  const body =
    metas.length === 0
      ? `<p class="empty">No sessions.</p>`
      : `<table><thead><tr><th>Id</th><th>Title</th><th>Persona</th><th>Model</th><th>Owner</th><th>Updated</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
  return layout(
    "Sessions",
    "/sessions",
    `<h1>Sessions (${metas.length})</h1>${body}`
  )
}

/**
 * Timeline events (see hooks/use-agent.ts TimelineEvent) carry their payload
 * in different fields per type — plain text in `text`/`content`, a tool call
 * in `name`+`arguments`, an image in `path`/`url`, a shell confirmation in
 * `command`+`description` — so there is no single field to read generically.
 */
function eventSummary(event: Record<string, unknown>): string {
  switch (event.type) {
    case "user":
    case "error":
    case "reasoning":
    case "ask_user":
      return escapeHtml(event.text ?? event.question ?? "")
    case "message":
    case "final":
      return escapeHtml(event.content ?? "")
    case "tool_call":
      return `<code>${escapeHtml(event.name)}</code>(${escapeHtml(event.arguments)})`
    case "tool_image":
      return escapeHtml(event.path)
    case "display_image":
      return escapeHtml(`${event.alt} (${event.url})`)
    case "confirm_command":
      return `<code>${escapeHtml(event.command)}</code> — ${escapeHtml(event.description)}`
    default:
      return ""
  }
}

export function sessionPage(session: PersistedSession): string {
  const events = session.events
    .map(
      (event) => `<tr>
<td><code>${escapeHtml(event.type)}</code></td>
<td>${eventSummary(event)}</td>
</tr>`
    )
    .join("")
  return layout(
    `Session #${session.id}`,
    "/sessions",
    `<h1>#${session.id} ${escapeHtml(session.title)}</h1>
<p class="meta">${escapeHtml(session.persona)} · ${escapeHtml(session.model)} · ${escapeHtml(session.owner ?? "terminal")} · created ${escapeHtml(session.createdAt.slice(0, 16).replace("T", " "))} · updated ${escapeHtml(session.updatedAt.slice(0, 16).replace("T", " "))}</p>
<table><thead><tr><th>Event</th><th>Text</th></tr></thead><tbody>${events}</tbody></table>
<details><summary>Raw session JSON (${session.session.messages.length} messages)</summary>
<pre><code>${escapeHtml(JSON.stringify(session.session, null, 2))}</code></pre></details>
<details><summary>Raw events JSON (${session.events.length} events)</summary>
<pre><code>${escapeHtml(JSON.stringify(session.events, null, 2))}</code></pre></details>`
  )
}

export function gamePage(data: {
  results: GameResult[]
  rounds: { topic: string; remainingCount: number; updatedAt: string }[]
}): string {
  const results = data.results
    .map(
      (result) => `<tr>
<td>${escapeHtml(result.topic)}</td>
<td>${escapeHtml(result.name)}</td>
<td>${escapeHtml(result.rating)}</td>
<td>${escapeHtml(result.description)}</td>
<td>${escapeHtml(result.confirmedAt.slice(0, 10))}</td>
</tr>`
    )
    .join("")
  const rounds = data.rounds
    .map(
      (round) => `<tr>
<td>${escapeHtml(round.topic)}</td>
<td>${round.remainingCount}</td>
<td>${escapeHtml(round.updatedAt.slice(0, 16).replace("T", " "))}</td>
</tr>`
    )
    .join("")
  const resultsBody =
    data.results.length === 0
      ? `<p class="empty">No confirmed results.</p>`
      : `<table><thead><tr><th>Topic</th><th>Name</th><th>Rating</th><th>Description</th><th>Confirmed</th></tr></thead><tbody>${results}</tbody></table>`
  const roundsBody =
    data.rounds.length === 0
      ? `<p class="empty">No rounds in progress.</p>`
      : `<table><thead><tr><th>Topic</th><th>Remaining</th><th>Updated</th></tr></thead><tbody>${rounds}</tbody></table>`
  return layout(
    "Game",
    "/game",
    `<h1>Game results (${data.results.length})</h1>${resultsBody}
<h1>Rounds in progress (${data.rounds.length})</h1>${roundsBody}`
  )
}

export function notFoundPage(): string {
  return layout("Not found", "/", `<h1>404</h1><p class="empty">Not found.</p>`)
}
