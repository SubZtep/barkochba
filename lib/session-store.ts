import {
  type PersistedSession,
  PersistedSessionSchema,
  type SessionMeta
} from "../schemas/session"
import { getDb } from "./memory-store"

/**
 * Persists conversations into the memory database (one row per session in
 * the `sessions` table, whole row rewritten after each turn — chat-scale
 * data). Deliberately built only on memory-store's shared connection —
 * never on lib/agents.ts or lib/openai.ts, which read the LLM config at
 * import time; listing and resuming sessions must work without one.
 */

type SessionRowData = {
  persona: string
  model: string
  /** lib/agents.ts Session — opaque here, serialized as JSON. */
  session: unknown
  /** hooks/use-agent.ts TimelineEvent[] — opaque here, serialized as JSON. */
  events: unknown[]
}

export async function createSessionRow(
  data: SessionRowData & { title: string }
): Promise<number> {
  const database = await getDb()
  const now = new Date().toISOString()
  const result = database
    .query(`
      INSERT INTO sessions (createdAt, updatedAt, persona, model, title, session, events)
      VALUES ($createdAt, $updatedAt, $persona, $model, $title, $session, $events)
    `)
    .run({
      $createdAt: now,
      $updatedAt: now,
      $persona: data.persona,
      $model: data.model,
      $title: data.title,
      $session: JSON.stringify(data.session),
      $events: JSON.stringify(data.events)
    })
  return Number(result.lastInsertRowid)
}

export async function updateSessionRow(id: number, data: SessionRowData) {
  const database = await getDb()
  database
    .query(`
      UPDATE sessions
      SET updatedAt = $updatedAt, persona = $persona, model = $model,
          session = $session, events = $events
      WHERE id = $id
    `)
    .run({
      $id: id,
      $updatedAt: new Date().toISOString(),
      $persona: data.persona,
      $model: data.model,
      $session: JSON.stringify(data.session),
      $events: JSON.stringify(data.events)
    })
}

type SessionRow = Omit<PersistedSession, "session" | "events"> & {
  session: string
  events: string
}

const SESSION_COLUMNS =
  "id, createdAt, updatedAt, persona, model, title, session, events"

/** A corrupt row (bad JSON or shape) resumes as nothing, not as a crash. */
function rowToSession(row: SessionRow): PersistedSession | undefined {
  try {
    const parsed = PersistedSessionSchema.safeParse({
      ...row,
      session: JSON.parse(row.session),
      events: JSON.parse(row.events)
    })
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

export async function loadSessionRow(
  id: number
): Promise<PersistedSession | undefined> {
  const database = await getDb()
  const row = database
    .query(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = $id`)
    .get({ $id: id }) as SessionRow | null
  return row ? rowToSession(row) : undefined
}

/** Ordered by updatedAt so resuming an old session makes it "latest" again. */
export async function loadLatestSessionRow(): Promise<
  PersistedSession | undefined
> {
  const database = await getDb()
  const row = database
    .query(
      `SELECT ${SESSION_COLUMNS} FROM sessions ORDER BY updatedAt DESC, id DESC LIMIT 1`
    )
    .get() as SessionRow | null
  return row ? rowToSession(row) : undefined
}

/** Newest first; the payload blobs are not selected. */
export async function listSessions(): Promise<SessionMeta[]> {
  const database = await getDb()
  return database
    .query(
      "SELECT id, createdAt, updatedAt, persona, model, title FROM sessions ORDER BY updatedAt DESC, id DESC"
    )
    .all() as SessionMeta[]
}

/**
 * The human's past prompts across all sessions, newest first, for shell-style
 * ↑/↓ recall in the input. Derived from the stored timelines' `user` events
 * (only human-typed prompts produce those; command-result feedback doesn't),
 * so there is no separate history table to keep in sync. Consecutive
 * duplicates are collapsed like a shell's HISTCONTROL=ignoredups.
 */
export async function loadPromptHistory(limit = 100): Promise<string[]> {
  const database = await getDb()
  const rows = database
    .query(`
      SELECT je.value ->> 'text' AS text
      FROM sessions AS s, json_each(s.events) AS je
      WHERE je.value ->> 'type' = 'user'
      ORDER BY s.id DESC, je.key DESC
      LIMIT $limit
    `)
    .all({ $limit: limit }) as { text: unknown }[]

  const prompts: string[] = []
  for (const row of rows) {
    if (typeof row.text !== "string" || row.text.length === 0) continue
    if (prompts[prompts.length - 1] === row.text) continue
    prompts.push(row.text)
  }
  return prompts
}
