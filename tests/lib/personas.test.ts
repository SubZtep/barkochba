import { afterEach, expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadPersonas } from "../../lib/personas"
import type { ResolvedModel } from "../../schemas/models"

// getConfigDir() reads XDG_CONFIG_HOME fresh on every call, so setting it
// per-test isolates each test from the real ~/.config/kaja — same pattern as
// tests/lib/datasets.test.ts.
const fixtureConfigDir = join(import.meta.dir, "../fixtures/personas")
const emptyConfigDir = join(tmpdir(), `kaja-test-personas-empty-${Date.now()}`)
process.env.NODE_ENV = "test"

const models: ResolvedModel[] = []

afterEach(async () => {
  delete process.env.XDG_CONFIG_HOME
  await rm(emptyConfigDir, { recursive: true, force: true })
})

test("loads valid persona files, keyed by filename id", async () => {
  process.env.XDG_CONFIG_HOME = fixtureConfigDir
  const personas = await loadPersonas(models)
  const byId = new Map(personas.map((p) => [p.id, p]))
  expect(byId.get("default")?.label).toBe("Helpful assistant")
  expect(byId.get("barkochba")?.label).toBe("Barkochba guesser")
})

test("skips a persona file that fails schema validation, without throwing", async () => {
  process.env.XDG_CONFIG_HOME = fixtureConfigDir
  const personas = await loadPersonas(models)
  expect(personas.some((p) => p.id === "broken")).toBe(false)
  // Valid files still load despite the broken one being present.
  expect(personas.some((p) => p.id === "default")).toBe(true)
})

test("skips a persona naming a model id not present in models", async () => {
  process.env.XDG_CONFIG_HOME = fixtureConfigDir
  const personas = await loadPersonas(models)
  expect(personas.some((p) => p.id === "unknown-model")).toBe(false)
})

test("writes default template personas on first run when the directory is missing", async () => {
  process.env.XDG_CONFIG_HOME = emptyConfigDir
  const personas = await loadPersonas(models)
  const ids = personas.map((p) => p.id).sort()
  expect(ids).toEqual(["barkochba", "care", "default"])
})
