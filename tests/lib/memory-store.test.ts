import { afterEach, expect, test } from "bun:test"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  getDefaultMemoryDbPath,
  loadMemory,
  saveMemory
} from "../../lib/memory-store"
import { getPaths } from "../../lib/paths"

// XDG_DATA_HOME/XDG_CONFIG_HOME are read fresh on every call (see
// getConfigPath/getDefaultMemoryDbPath) rather than cached at module load,
// so setting them per-test — even though this module was likely already
// imported by another test file earlier in the same `bun test` process —
// still isolates each test from the real ~/.local/share/kaja and
// ~/.config/kaja.
const dataDir = `${tmpdir()}/kaja-test-xdg-data`
const configDir = `${tmpdir()}/kaja-test-xdg-config`

afterEach(async () => {
  process.env.XDG_DATA_HOME = dataDir
  process.env.XDG_CONFIG_HOME = configDir
  await saveMemory({})
})

test("loadMemory returns {} for a freshly created store", async () => {
  process.env.XDG_DATA_HOME = dataDir
  process.env.XDG_CONFIG_HOME = configDir
  expect(await loadMemory()).toEqual({})
})

test("saveMemory then loadMemory round-trips", async () => {
  process.env.XDG_DATA_HOME = dataDir
  process.env.XDG_CONFIG_HOME = configDir
  const note = {
    content: "test fact",
    importance: "high" as const,
    tags: ["a", "b"],
    sticky: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastUsedAt: "2026-01-01T00:00:00.000Z",
    useCount: 0
  }
  await saveMemory({ "test:key": note })
  expect(await loadMemory()).toEqual({ "test:key": note })
})

test("saveMemory replaces the whole store (removes keys no longer present)", async () => {
  process.env.XDG_DATA_HOME = dataDir
  process.env.XDG_CONFIG_HOME = configDir
  await saveMemory({
    "test:a": {
      content: "a",
      importance: "low",
      tags: [],
      sticky: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: "2026-01-01T00:00:00.000Z",
      useCount: 0
    }
  })
  await saveMemory({
    "test:b": {
      content: "b",
      importance: "low",
      tags: [],
      sticky: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: "2026-01-01T00:00:00.000Z",
      useCount: 0
    }
  })
  const store = await loadMemory()
  expect(Object.keys(store)).toEqual(["test:b"])
})

test("data persists across a fresh process (module re-import)", async () => {
  process.env.XDG_DATA_HOME = dataDir
  process.env.XDG_CONFIG_HOME = configDir
  const note = {
    content: "persisted fact",
    importance: "medium" as const,
    tags: [],
    sticky: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastUsedAt: "2026-01-01T00:00:00.000Z",
    useCount: 0
  }
  await saveMemory({ "test:persist": note })
  expect(existsSync(getDefaultMemoryDbPath())).toBe(true)

  // Simulate a process restart by running a fresh `bun` invocation against
  // the same on-disk database, instead of re-importing within this process
  // (module-level singletons like the cached Database connection would
  // survive a same-process re-import and wouldn't prove real persistence).
  const result =
    await Bun.$`XDG_DATA_HOME=${dataDir} XDG_CONFIG_HOME=${configDir} bun -e ${`
      import { loadMemory } from "${join(import.meta.dir, "../../lib/memory-store.ts")}"
      console.log(JSON.stringify(await loadMemory()))
    `}`.text()
  expect(JSON.parse(result.trim())).toEqual({ "test:persist": note })
})

test("migrates a pre-existing memory.json into SQLite on first open, keeping it as .bak", async () => {
  const xdgDataHome = `${tmpdir()}/kaja-test-xdg-data-migration`
  await rm(xdgDataHome, { recursive: true, force: true })
  // getPaths() appends its own "kaja"/"kaja-dev" subdirectory under
  // XDG_DATA_HOME, and includes the "-dev" suffix whenever NODE_ENV is
  // "development" (as it is in a local dev shell) — so the subprocess below,
  // which resolves the same way, must agree on this directory.
  const priorXdgDataHome = process.env.XDG_DATA_HOME
  process.env.XDG_DATA_HOME = xdgDataHome
  const migrationDir = getPaths().data
  process.env.XDG_DATA_HOME = priorXdgDataHome
  const { mkdirSync } = await import("node:fs")
  mkdirSync(migrationDir, { recursive: true })

  const legacyStore = {
    "user:name": {
      content: "Andras",
      importance: "high",
      tags: ["user"],
      sticky: true,
      createdAt: "2025-06-01T00:00:00.000Z",
      lastUsedAt: "2025-12-01T00:00:00.000Z",
      useCount: 7
    }
  }
  writeFileSync(
    join(migrationDir, "memory.json"),
    JSON.stringify(legacyStore, null, 2)
  )

  const result =
    await Bun.$`XDG_DATA_HOME=${xdgDataHome} XDG_CONFIG_HOME=${configDir} bun -e ${`
      import { loadMemory } from "${join(import.meta.dir, "../../lib/memory-store.ts")}"
      console.log(JSON.stringify(await loadMemory()))
    `}`.text()

  expect(JSON.parse(result.trim())).toEqual(legacyStore)
  expect(existsSync(join(migrationDir, "memory.json.bak"))).toBe(true)
  expect(
    JSON.parse(readFileSync(join(migrationDir, "memory.json.bak"), "utf8"))
  ).toEqual(legacyStore)
  expect(existsSync(join(migrationDir, "memory.json"))).toBe(false)
  expect(existsSync(join(migrationDir, "memory.sqlite"))).toBe(true)

  await rm(xdgDataHome, { recursive: true, force: true })
})
