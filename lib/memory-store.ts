import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { file, write } from "bun"
import type { MemoryNote, MemoryStore } from "../schemas/memory"
import { getConfigPath, invalidateConfigCache, readConfigLoose } from "./config"
import { getPaths } from "./paths"

// Computed fresh on every call, not as a module-level constant: see the same
// note on getConfigDir/getConfigPath in lib/config.ts — tests run many spec
// files in one process and mutate XDG_DATA_HOME per file.
export function getDefaultMemoryDbPath() {
  return join(getPaths().data, "memory.sqlite")
}

/**
 * Resolves the database path to open: `config.memory.dbPath` if set,
 * otherwise the default XDG data location. Uses {@link readConfigLoose},
 * not {@link import("./config").config}, because managing memory (the
 * `kaja memory` CLI, and this module in general) must keep working even
 * with a missing or invalid config.json.
 */
export async function resolveMemoryDbPath(): Promise<string> {
  const loose = await readConfigLoose()
  return loose.memory?.dbPath || getDefaultMemoryDbPath()
}

/**
 * After a database has been opened successfully at `dbPath` (proving that
 * path works), writes it into config.json's `memory.dbPath` if that key
 * wasn't already set there — so the effective path becomes explicit and
 * user-editable instead of implicit. Never touches config.json if it
 * doesn't exist yet (fresh install with no config) or already has
 * `memory.dbPath` set. Best-effort: a write failure here must not break
 * memory itself, so errors are swallowed.
 */
async function persistDbPathIfMissing(dbPath: string) {
  try {
    const configPath = getConfigPath()
    if (!(await file(configPath).exists())) return
    const loose = await readConfigLoose()
    if (loose.memory?.dbPath) return
    await write(
      file(configPath),
      JSON.stringify({ ...loose, memory: { ...loose.memory, dbPath } }, null, 2)
    )
    invalidateConfigCache()
  } catch {}
}

const SCHEMA_VERSION = 7

const INSERT_NOTE_SQL = `
  INSERT INTO notes (key, content, importance, tags, sticky, createdAt, lastUsedAt, useCount)
  VALUES ($key, $content, $importance, $tags, $sticky, $createdAt, $lastUsedAt, $useCount)
`

function noteParams(key: string, note: MemoryNote) {
  return {
    $key: key,
    $content: note.content,
    $importance: note.importance,
    $tags: JSON.stringify(note.tags),
    $sticky: note.sticky ? 1 : 0,
    $createdAt: note.createdAt,
    $lastUsedAt: note.lastUsedAt,
    $useCount: note.useCount
  }
}

let db: Database | undefined
let dbPathInUse: string | undefined

/**
 * Opens (creating if needed) the memory database. Cached module-wide
 * (SQLite wants a persistent connection), but keyed by
 * the resolved path: if `resolveMemoryDbPath()` returns something different
 * from the cached connection's path, that connection is closed and a fresh
 * one opened. In a real run the resolved path never changes mid-process, so
 * this never fires — it only matters for tests, which run many logically
 * separate "sessions" (each with its own XDG_DATA_HOME/config.memory.dbPath)
 * in one shared `bun test` process.
 *
 * Exported as the shared seam for lib/session-store.ts, which lives in the
 * same database file — this module stays the single owner of the schema.
 */
export async function getDb(): Promise<Database> {
  const dbPath = await resolveMemoryDbPath()
  if (db && dbPathInUse === dbPath) return db

  db?.close()
  mkdirSync(dirname(dbPath), { recursive: true })
  db = new Database(dbPath, { create: true })
  dbPathInUse = dbPath
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA synchronous = NORMAL") // safe pairing w/ WAL, faster than FULL
  db.exec("PRAGMA busy_timeout = 5000") // wait up to 5s on lock instead of throwing
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)"
  )
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      key         TEXT PRIMARY KEY,
      content     TEXT NOT NULL,
      importance  TEXT NOT NULL CHECK (importance IN ('low','medium','high')),
      tags        TEXT NOT NULL,
      sticky      INTEGER NOT NULL,
      createdAt   TEXT NOT NULL,
      lastUsedAt  TEXT NOT NULL,
      useCount    INTEGER NOT NULL
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      persona   TEXT NOT NULL,
      model     TEXT NOT NULL,
      title     TEXT NOT NULL,
      owner     TEXT,           -- NULL = terminal session; 'telegram:<id>' otherwise
      session   TEXT NOT NULL,  -- JSON: lib/agents.ts Session
      events    TEXT NOT NULL   -- JSON: hooks/use-agent.ts TimelineEvent[]
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS dataset_answers (
      topic      TEXT NOT NULL,
      -- '' = terminal session; 'telegram:<id>' otherwise. NOT NULL (unlike
      -- sessions.owner) because SQLite's PRIMARY KEY uniqueness treats every
      -- NULL as distinct from every other NULL, which would silently break
      -- the upsert below for every terminal-session row; ownerKey()/ownerOf()
      -- translate to/from the public string-or-null convention at the edges.
      owner      TEXT NOT NULL,
      version    INTEGER NOT NULL,
      field      TEXT NOT NULL,
      value      TEXT NOT NULL,
      answeredAt TEXT NOT NULL,
      PRIMARY KEY (topic, owner, version, field)
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS dataset_versions (
      topic       TEXT NOT NULL,
      owner       TEXT NOT NULL,
      version     INTEGER NOT NULL,
      completedAt TEXT NOT NULL,
      PRIMARY KEY (topic, owner, version)
    )
  `)

  const hasVersion = db
    .query("SELECT version FROM schema_version LIMIT 1")
    .get() as { version: number } | null
  if (!hasVersion) {
    db.query("INSERT INTO schema_version (version) VALUES (?)").run(
      SCHEMA_VERSION
    )
  } else if (hasVersion.version < SCHEMA_VERSION) {
    // v1 → v2 added the sessions table; v2 → v3 added game_results and
    // game_rounds; v3 → v4 added game_results.rating; v4 → v5 added
    // game_results.embedding — all purely additive, and (since those columns
    // were only ever added to the CREATE TABLE IF NOT EXISTS DDL above) only
    // actually took effect on a brand-new database file, not on an existing
    // one being upgraded across versions. v5 → v6 is the first migration
    // that must actually alter an existing table: sessions gains `owner`
    // (NULL = terminal session) so Telegram users each resume their own last
    // session instead of whichever is globally latest. SQLite has no ADD
    // COLUMN IF NOT EXISTS, so guard with try/catch in case this file was
    // already altered but schema_version is stale for some reason.
    if (hasVersion.version < 6) {
      try {
        db.exec("ALTER TABLE sessions ADD COLUMN owner TEXT")
      } catch {}
    }
    // v6 → v7 replaces the like-or-not game (game_results, game_rounds) with
    // the dataset info collector (dataset_answers, dataset_versions) — the
    // old tables are dropped outright since this is a full feature
    // replacement, not an additive migration.
    if (hasVersion.version < 7) {
      try {
        db.exec("DROP TABLE IF EXISTS game_results")
      } catch {}
      try {
        db.exec("DROP TABLE IF EXISTS game_rounds")
      } catch {}
    }
    db.query("UPDATE schema_version SET version = ?").run(SCHEMA_VERSION)
  }

  // Only persist the path back to config.json once we know it works — the
  // database above opened and initialized without throwing.
  await persistDbPathIfMissing(dbPath)

  return db
}

/**
 * One-line note header shared by the memory tools and the `kaja memory`
 * CLI, so the model and the human see the same self-explanatory metadata
 * (importance, sticky, tags, last-used day) everywhere:
 * `user:who-they-are [high, sticky] (tags: user, kaja) (used 2026-07-18)`
 */
export function noteHeader(key: string, note: MemoryNote) {
  const flags = note.sticky ? `${note.importance}, sticky` : note.importance
  const tags = note.tags.length > 0 ? ` (tags: ${note.tags.join(", ")})` : ""
  return `${key} [${flags}]${tags} (used ${note.lastUsedAt.slice(0, 10)})`
}

/**
 * Deletes notes from a store in place by exact key, by tag, or by key glob
 * pattern, returning the deleted keys (without saving — callers decide).
 */
export function forgetNotes(
  store: MemoryStore,
  selector: { key?: string; tag?: string; pattern?: string }
): string[] {
  let victims: string[]
  if (selector.key !== undefined) {
    victims = selector.key in store ? [selector.key] : []
  } else if (selector.tag !== undefined) {
    victims = Object.entries(store)
      .filter(([, note]) => note.tags.includes(selector.tag!))
      .map(([key]) => key)
  } else if (selector.pattern !== undefined) {
    const glob = new Bun.Glob(selector.pattern)
    victims = Object.keys(store).filter((key) => glob.match(key))
  } else {
    victims = []
  }
  for (const key of victims) delete store[key]
  return victims
}

function rowToNote(row: {
  content: string
  importance: string
  tags: string
  sticky: number
  createdAt: string
  lastUsedAt: string
  useCount: number
}): MemoryNote {
  return {
    content: row.content,
    importance: row.importance as MemoryNote["importance"],
    tags: JSON.parse(row.tags),
    sticky: row.sticky === 1,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    useCount: row.useCount
  }
}

export async function loadMemory(): Promise<MemoryStore> {
  const database = await getDb()
  const rows = database
    .query(
      "SELECT key, content, importance, tags, sticky, createdAt, lastUsedAt, useCount FROM notes"
    )
    .all() as ({ key: string } & Parameters<typeof rowToNote>[0])[]

  const store: MemoryStore = {}
  for (const row of rows) store[row.key] = rowToNote(row)
  return store
}

export async function saveMemory(store: MemoryStore) {
  const database = await getDb()

  const deleteAll = database.query("DELETE FROM notes")
  const insert = database.query(INSERT_NOTE_SQL)

  database.transaction(() => {
    deleteAll.run()
    for (const [key, note] of Object.entries(store))
      insert.run(noteParams(key, note))
  })()
}

export type DatasetAnswer = {
  field: string
  value: string
  answeredAt: string
}

// dataset_answers/dataset_versions store owner as a NOT NULL TEXT column
// ('' for terminal sessions) rather than the public `string | null`
// convention used elsewhere (e.g. sessions.owner) — see the CREATE TABLE
// comment above for why. These translate at the boundary so every exported
// function here still speaks `string | null` like the rest of the app.
function ownerKey(owner: string | null): string {
  return owner ?? ""
}
function ownerOf(key: string): string | null {
  return key === "" ? null : key
}

/**
 * Latest version number recorded for (topic, owner), across both answers and
 * completions (a version may exist with only partial answers and no
 * completion row yet). Returns 0 if no version has ever been started.
 */
export async function latestDatasetVersion(
  topic: string,
  owner: string | null
): Promise<number> {
  const database = await getDb()
  const row = database
    .query(
      `SELECT MAX(version) AS version FROM (
         SELECT version FROM dataset_answers WHERE topic = $topic AND owner = $owner
         UNION ALL
         SELECT version FROM dataset_versions WHERE topic = $topic AND owner = $owner
       )`
    )
    .get({ $topic: topic, $owner: ownerKey(owner) }) as {
    version: number | null
  } | null
  return row?.version ?? 0
}

export async function loadDatasetAnswers(
  topic: string,
  owner: string | null,
  version: number
): Promise<DatasetAnswer[]> {
  const database = await getDb()
  return database
    .query(
      `SELECT field, value, answeredAt FROM dataset_answers
       WHERE topic = $topic AND owner = $owner AND version = $version
       ORDER BY answeredAt ASC`
    )
    .all({
      $topic: topic,
      $owner: ownerKey(owner),
      $version: version
    }) as DatasetAnswer[]
}

/**
 * Upserts one field's answer for (topic, owner, version) — re-answering the
 * same field within a version corrects it in place rather than duplicating.
 */
export async function saveDatasetAnswer(
  topic: string,
  owner: string | null,
  version: number,
  field: string,
  value: string
): Promise<void> {
  const database = await getDb()
  database
    .query(
      `INSERT INTO dataset_answers (topic, owner, version, field, value, answeredAt)
       VALUES ($topic, $owner, $version, $field, $value, $answeredAt)
       ON CONFLICT(topic, owner, version, field) DO UPDATE SET value = excluded.value, answeredAt = excluded.answeredAt`
    )
    .run({
      $topic: topic,
      $owner: ownerKey(owner),
      $version: version,
      $field: field,
      $value: value,
      $answeredAt: new Date().toISOString()
    })
}

/**
 * Records completion time for (topic, owner, version) — call once, when the
 * version's last required field is first answered. A no-op if already
 * recorded (INSERT OR IGNORE), so it's safe to call unconditionally whenever
 * the caller detects "now complete" without checking first.
 */
export async function markDatasetVersionComplete(
  topic: string,
  owner: string | null,
  version: number
): Promise<void> {
  const database = await getDb()
  database
    .query(
      `INSERT OR IGNORE INTO dataset_versions (topic, owner, version, completedAt)
       VALUES ($topic, $owner, $version, $completedAt)`
    )
    .run({
      $topic: topic,
      $owner: ownerKey(owner),
      $version: version,
      $completedAt: new Date().toISOString()
    })
}

export async function loadDatasetVersionCompletedAt(
  topic: string,
  owner: string | null,
  version: number
): Promise<string | undefined> {
  const database = await getDb()
  const row = database
    .query(
      "SELECT completedAt FROM dataset_versions WHERE topic = $topic AND owner = $owner AND version = $version"
    )
    .get({
      $topic: topic,
      $owner: ownerKey(owner),
      $version: version
    }) as { completedAt: string } | null
  return row?.completedAt
}

/**
 * Every (topic, owner, version) that has at least one answer, with its
 * answered-field count and completion time (if any) — a list-view
 * projection for the `kaja web` browser. `totalFields` isn't known here
 * (it depends on the current dataset config, loaded separately by callers).
 */
export async function listDatasetVersionsSummary(): Promise<
  {
    topic: string
    owner: string | null
    version: number
    answeredCount: number
    completedAt: string | undefined
  }[]
> {
  const database = await getDb()
  const rows = database
    .query(
      `SELECT a.topic AS topic, a.owner AS owner, a.version AS version,
              COUNT(*) AS answeredCount, v.completedAt AS completedAt
       FROM dataset_answers a
       LEFT JOIN dataset_versions v
         ON v.topic = a.topic AND v.owner = a.owner AND v.version = a.version
       GROUP BY a.topic, a.owner, a.version
       ORDER BY a.topic ASC, a.owner ASC, a.version ASC`
    )
    .all() as {
    topic: string
    owner: string
    version: number
    answeredCount: number
    completedAt: string | null
  }[]
  return rows.map((row) => ({
    ...row,
    owner: ownerOf(row.owner),
    completedAt: row.completedAt ?? undefined
  }))
}

/** All answers across every (topic, owner, version) — for the `kaja web` browser. */
export async function listAllDatasetAnswers(): Promise<
  (DatasetAnswer & { topic: string; owner: string | null; version: number })[]
> {
  const database = await getDb()
  const rows = database
    .query(
      `SELECT topic, owner, version, field, value, answeredAt FROM dataset_answers
       ORDER BY topic ASC, owner ASC, version ASC, answeredAt ASC`
    )
    .all() as (DatasetAnswer & {
    topic: string
    owner: string
    version: number
  })[]
  return rows.map((row) => ({ ...row, owner: ownerOf(row.owner) }))
}
