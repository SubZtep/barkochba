import { afterEach, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadDataset, loadDatasets } from "../../lib/datasets"

// getConfigDir() reads XDG_CONFIG_HOME fresh on every call, so setting it
// per-test isolates each test from the real ~/.config/kaja — same pattern as
// tests/lib/plugin-tools.test.ts.
const fixtureConfigDir = join(import.meta.dir, "../fixtures/datasets")
const emptyConfigDir = `${tmpdir()}/kaja-test-datasets-empty`

afterEach(() => {
  delete process.env.XDG_CONFIG_HOME
})

test("loads valid dataset files, keyed by topic (filename minus extension)", async () => {
  process.env.XDG_CONFIG_HOME = fixtureConfigDir
  const datasets = await loadDatasets()
  expect(datasets.has("movies")).toBe(true)
  expect(datasets.get("movies")!.label).toBe("Movies to watch")
  expect(datasets.get("movies")!.entries).toHaveLength(9)
})

test("skips a dataset file that fails schema validation, without throwing", async () => {
  process.env.XDG_CONFIG_HOME = fixtureConfigDir
  const datasets = await loadDatasets()
  expect(datasets.has("broken")).toBe(false)
  // Valid files still load despite the broken one being present.
  expect(datasets.has("movies")).toBe(true)
})

test("applies excludeNames and excludeKeywords to filter entries", async () => {
  process.env.XDG_CONFIG_HOME = fixtureConfigDir
  const dataset = await loadDataset("filtered")
  expect(dataset).toBeDefined()
  const names = dataset!.entries.map((e) => e.name)
  expect(names).toEqual(["Allowed"])
})

test("returns an empty map when the datasets directory doesn't exist", async () => {
  process.env.XDG_CONFIG_HOME = emptyConfigDir
  expect(await loadDatasets()).toEqual(new Map())
})

test("loadDataset returns undefined for an unknown topic", async () => {
  process.env.XDG_CONFIG_HOME = fixtureConfigDir
  expect(await loadDataset("nonexistent")).toBeUndefined()
})
