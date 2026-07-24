import { afterEach, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadPluginTools } from "../../lib/plugin-tools"

// getConfigDir() reads XDG_CONFIG_HOME fresh on every call, so setting it
// per-test isolates each test from the real ~/.config/kaja — same pattern
// as tests/lib/memory-store.test.ts. The fixture tree only has a `kaja/`
// subdirectory (not `kaja-dev/`), so NODE_ENV is pinned too — getConfigDir()
// appends "-dev" to the suffix when NODE_ENV=development, which would miss
// the fixtures entirely if inherited from the invoking shell.
const fixtureConfigDir = join(import.meta.dir, "../fixtures/plugin-tools")
const emptyConfigDir = `${tmpdir()}/kaja-test-plugin-tools-empty`
process.env.NODE_ENV = "test"

afterEach(() => {
  delete process.env.XDG_CONFIG_HOME
})

test("loads a valid exported Tool and ignores non-Tool exports", async () => {
  process.env.XDG_CONFIG_HOME = fixtureConfigDir
  const tools = await loadPluginTools()
  expect(tools.map((t) => t.definition.function.name)).toEqual(["ping"])
  expect(await tools[0]!.execute({})).toBe("pong")
})

test("skips a plugin file that throws on import, without throwing itself", async () => {
  process.env.XDG_CONFIG_HOME = fixtureConfigDir
  const tools = await loadPluginTools()
  // broken.ts throws on import; only ping.ts's export should survive.
  expect(tools).toHaveLength(1)
})

test("returns an empty array when the tools directory doesn't exist", async () => {
  process.env.XDG_CONFIG_HOME = emptyConfigDir
  expect(await loadPluginTools()).toEqual([])
})
