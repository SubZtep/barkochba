import { afterEach, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadDataset, loadDatasets } from "../../lib/datasets"

// getConfigDir() reads XDG_CONFIG_HOME fresh on every call, so setting it
// per-test isolates each test from the real ~/.config/kaja — same pattern as
// tests/lib/plugin-tools.test.ts.
const fixtureConfigDir = join(import.meta.dir, "../fixtures/datasets")
const emptyConfigDir = `${tmpdir()}/kaja-test-datasets-empty`
process.env.NODE_ENV = "test"

afterEach(() => {
  delete process.env.XDG_CONFIG_HOME
})

test("loads valid dataset files, keyed by topic (filename minus extension)", async () => {
  process.env.XDG_CONFIG_HOME = fixtureConfigDir
  const datasets = await loadDatasets()
  expect(datasets.has("onboarding")).toBe(true)
  expect(datasets.get("onboarding")!.label).toBe("Onboarding")
  expect(datasets.get("onboarding")!.fields).toHaveLength(2)
})

test("skips a dataset file that fails schema validation, without throwing", async () => {
  process.env.XDG_CONFIG_HOME = fixtureConfigDir
  const datasets = await loadDatasets()
  expect(datasets.has("broken")).toBe(false)
  // Valid files still load despite the broken one being present.
  expect(datasets.has("onboarding")).toBe(true)
})

test("loads a field's accepted values", async () => {
  process.env.XDG_CONFIG_HOME = fixtureConfigDir
  const dataset = await loadDataset("onboarding")
  expect(dataset).toBeDefined()
  const field = dataset!.fields.find((f) => f.name === "notification_pref")
  expect(field?.accepted).toEqual(["email", "push", "none"])
})

test("returns an empty map when the datasets directory doesn't exist", async () => {
  process.env.XDG_CONFIG_HOME = emptyConfigDir
  expect(await loadDatasets()).toEqual(new Map())
})

test("loadDataset returns undefined for an unknown topic", async () => {
  process.env.XDG_CONFIG_HOME = fixtureConfigDir
  expect(await loadDataset("nonexistent")).toBeUndefined()
})
