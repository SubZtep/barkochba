import { afterEach, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { write } from "bun"

process.env.XDG_CONFIG_HOME = `${tmpdir()}/kaja-test-xdg-config-config`

const { getConfigDir, getConfigPath, readConfigLoose, setConfigDirOverride } =
  await import("../../lib/config")

afterEach(() => {
  setConfigDirOverride(undefined)
})

test("getConfigDir defaults to the env-paths location", () => {
  expect(getConfigDir()).toBe(`${tmpdir()}/kaja-test-xdg-config-config/kaja`)
})

test("setConfigDirOverride redirects getConfigDir and getConfigPath", () => {
  const dir = `${tmpdir()}/kaja-test-config-override`
  setConfigDirOverride(dir)
  expect(getConfigDir()).toBe(dir)
  expect(getConfigPath()).toBe(join(dir, "config.json"))

  setConfigDirOverride(undefined)
  expect(getConfigDir()).toBe(`${tmpdir()}/kaja-test-xdg-config-config/kaja`)
})

test("config reads come from the overridden directory", async () => {
  const dir = `${tmpdir()}/kaja-test-config-override-read`
  await write(join(dir, "config.json"), JSON.stringify({ settings: {} }))
  setConfigDirOverride(dir)
  expect(await readConfigLoose()).toEqual({ settings: {} })
})
