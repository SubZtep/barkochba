import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs"
import { dirname, join } from "node:path"
import { file, write } from "bun"
import type { DatasetEntry } from "../schemas/datasets"
import {
  type MemoryNote,
  type MemoryStore,
  MemoryStoreSchema
} from "../schemas/memory"
import { getConfigPath, invalidateConfigCache, readConfigLoose } from "./config"
import { getPaths } from "./paths"

// Computed fresh on every call, not as a module-level constant: see the same
// note on getConfigDir/getConfigPath in lib/config.ts — tests run many spec
// files in one process and mutate XDG_DATA_HOME per file.
export function getDefaultMemoryDbPath() {
  return join(getPaths().data, "memory.sqlite")
}

function getLegacyJsonPath() {
  return join(getPaths().data, "memory.json")
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

const SCHEMA_VERSION = 5

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
 * Opens (creating if needed) the memory database, migrating any pre-existing
 * `memory.json` into it on first run. Cached module-wide (SQLite wants a
 * persistent connection, unlike the JSON file this replaces), but keyed by
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
      session   TEXT NOT NULL,  -- JSON: lib/agents.ts Session
      events    TEXT NOT NULL   -- JSON: hooks/use-agent.ts TimelineEvent[]
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS game_results (
      topic       TEXT NOT NULL,
      name        TEXT NOT NULL,
      description TEXT NOT NULL,
      rating      TEXT NOT NULL CHECK (rating IN ('love','like','neutral','dislike','hate')),
      confirmedAt TEXT NOT NULL,
      embedding   TEXT NOT NULL,  -- JSON: number[]
      PRIMARY KEY (topic, name)
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS game_rounds (
      topic     TEXT PRIMARY KEY,
      remaining TEXT NOT NULL,  -- JSON: DatasetEntry[]
      updatedAt TEXT NOT NULL
    )
  `)

  const hasVersion = db
    .query("SELECT version FROM schema_version LIMIT 1")
    .get() as { version: number } | null
  if (!hasVersion) {
    db.query("INSERT INTO schema_version (version) VALUES (?)").run(
      SCHEMA_VERSION
    )
    migrateLegacyJson(db)
  } else if (hasVersion.version < SCHEMA_VERSION) {
    // v1 → v2 added the sessions table; v2 → v3 added game_results and
    // game_rounds; v3 → v4 added game_results.rating; v4 → v5 added
    // game_results.embedding — all purely additive, already created by the
    // idempotent DDL above. Record the version so a future non-additive
    // migration has a real ladder to hang off.
    db.query("UPDATE schema_version SET version = ?").run(SCHEMA_VERSION)
  }

  // Only persist the path back to config.json once we know it works — the
  // database above opened and initialized without throwing.
  await persistDbPathIfMissing(dbPath)

  return db
}

/**
 * One-time import of a pre-existing `memory.json` into a freshly created
 * database, run inside the same "no schema_version row yet" check so it
 * never re-runs. The source file is kept as `memory.json.bak` (never
 * deleted) so a bad migration can be recovered from by hand.
 */
function migrateLegacyJson(database: Database) {
  const legacyJsonPath = getLegacyJsonPath()
  if (!existsSync(legacyJsonPath)) return

  let store: MemoryStore
  try {
    store = MemoryStoreSchema.parse(
      JSON.parse(readFileSync(legacyJsonPath, "utf8"))
    )
  } catch {
    return
  }

  const insert = database.query(INSERT_NOTE_SQL)
  database.transaction(() => {
    for (const [key, note] of Object.entries(store))
      insert.run(noteParams(key, note))
  })()

  renameSync(legacyJsonPath, `${legacyJsonPath}.bak`)
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

export type GameRating = "love" | "like" | "neutral" | "dislike" | "hate"

export type GameResult = {
  topic: string
  name: string
  description: string
  rating: GameRating
  confirmedAt: string
}

// Carries the embedding too — used only by the similarity search path
// (tools/like-or-not.ts 'similar' action), so ordinary GameResult callers
// (recall, listGameResults) don't have to handle the vector.
export type GameResultWithEmbedding = GameResult & { embedding: number[] }

/**
 * Records (or re-confirms) that a candidate was picked for a topic —
 * upserts by (topic, name), updating rating and confirmedAt on conflict so
 * re-confirming with a new rating changes it in place. The embedding is
 * immutable once set (omitted from the upsert's UPDATE clause) — the
 * candidate's name+description meaning doesn't change when its rating does.
 */
export async function confirmGameResult(
  topic: string,
  name: string,
  description: string,
  rating: GameRating,
  embedding: number[]
): Promise<void> {
  const database = await getDb()
  database
    .query(
      `INSERT INTO game_results (topic, name, description, rating, confirmedAt, embedding)
       VALUES ($topic, $name, $description, $rating, $confirmedAt, $embedding)
       ON CONFLICT(topic, name) DO UPDATE SET rating = excluded.rating, confirmedAt = excluded.confirmedAt`
    )
    .run({
      $topic: topic,
      $name: name,
      $description: description,
      $rating: rating,
      $confirmedAt: new Date().toISOString(),
      $embedding: JSON.stringify(embedding)
    })
}

export async function unconfirmGameResult(
  topic: string,
  name: string
): Promise<boolean> {
  const database = await getDb()
  const result = database
    .query("DELETE FROM game_results WHERE topic = $topic AND name = $name")
    .run({ $topic: topic, $name: name })
  return result.changes > 0
}

export async function listGameResults(topic: string): Promise<GameResult[]> {
  const database = await getDb()
  return database
    .query(
      "SELECT topic, name, description, rating, confirmedAt FROM game_results WHERE topic = $topic ORDER BY confirmedAt DESC"
    )
    .all({ $topic: topic }) as GameResult[]
}

/**
 * All confirmed results across every topic, with their embeddings — used by
 * the 'similar' action to find semantically related picks regardless of
 * which topic they belong to.
 */
export async function listAllGameResults(): Promise<GameResultWithEmbedding[]> {
  const database = await getDb()
  const rows = database
    .query(
      "SELECT topic, name, description, rating, confirmedAt, embedding FROM game_results"
    )
    .all() as (GameResult & { embedding: string })[]
  return rows.map((row) => ({ ...row, embedding: JSON.parse(row.embedding) }))
}

/**
 * Persists a topic's in-progress round (the narrowed candidate pool) so it
 * survives a process restart — every 'filter' call saves here, not just
 * 'confirm'. Upserts by topic (one round per topic at a time).
 */
export async function saveGameRound(
  topic: string,
  remaining: DatasetEntry[]
): Promise<void> {
  const database = await getDb()
  database
    .query(
      `INSERT INTO game_rounds (topic, remaining, updatedAt)
       VALUES ($topic, $remaining, $updatedAt)
       ON CONFLICT(topic) DO UPDATE SET remaining = excluded.remaining, updatedAt = excluded.updatedAt`
    )
    .run({
      $topic: topic,
      $remaining: JSON.stringify(remaining),
      $updatedAt: new Date().toISOString()
    })
}

export async function loadGameRound(
  topic: string
): Promise<DatasetEntry[] | undefined> {
  const database = await getDb()
  const row = database
    .query("SELECT remaining FROM game_rounds WHERE topic = $topic")
    .get({ $topic: topic }) as { remaining: string } | null
  return row ? (JSON.parse(row.remaining) as DatasetEntry[]) : undefined
}

export async function clearGameRound(topic: string): Promise<void> {
  const database = await getDb()
  database.query("DELETE FROM game_rounds WHERE topic = $topic").run({
    $topic: topic
  })
}
