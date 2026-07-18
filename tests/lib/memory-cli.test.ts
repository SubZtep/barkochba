import { afterEach, expect, test } from "bun:test"
import { rm } from "node:fs/promises"

process.env.XDG_DATA_HOME = `${import.meta.dir}/../../.tmp-test-xdg-data-cli`

const { memoryPath, saveMemory } = await import("../../lib/memory-store")
const { runMemoryCli } = await import("../../lib/memory-cli")

const NOTE = {
  importance: "low" as const,
  tags: ["test"],
  sticky: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  lastUsedAt: "2026-01-01T00:00:00.000Z",
  useCount: 0
}

afterEach(async () => {
  await rm(memoryPath, { force: true })
})

test("list prints headers with content", async () => {
  await saveMemory({
    "user:a": { ...NOTE, content: "fact a" },
    "test:b": { ...NOTE, content: "fact b" }
  })
  const { code, text } = await runMemoryCli(["list"])
  expect(code).toBe(0)
  expect(text).toContain("user:a [low] (tags: test) (used 2026-01-01)")
  expect(text).toContain("  fact a")
  expect(text).toContain("  fact b")
})

test("list on an empty store", async () => {
  const { code, text } = await runMemoryCli(["list"])
  expect(code).toBe(0)
  expect(text).toBe("(no notes stored)")
})

test("forget deletes by exact key", async () => {
  await saveMemory({
    "user:a": { ...NOTE, content: "keep" },
    "user:b": { ...NOTE, content: "drop" }
  })
  const { code, text } = await runMemoryCli(["forget", "user:b"])
  expect(code).toBe(0)
  expect(text).toBe("Forgot: user:b")

  const list = await runMemoryCli(["list"])
  expect(list.text).toContain("user:a")
  expect(list.text).not.toContain("user:b")
})

test("forget deletes in bulk by glob", async () => {
  await saveMemory({
    "test:a": { ...NOTE, content: "probe" },
    "test:b": { ...NOTE, content: "probe" },
    "user:keep": { ...NOTE, content: "real" }
  })
  const { code, text } = await runMemoryCli(["forget", "test:*"])
  expect(code).toBe(0)
  expect(text).toContain("test:a")
  expect(text).toContain("test:b")

  const list = await runMemoryCli(["list"])
  expect(list.text).toContain("user:keep")
  expect(list.text).not.toContain("test:a")
})

test("forget with no match exits 1", async () => {
  const { code, text } = await runMemoryCli(["forget", "nope"])
  expect(code).toBe(1)
  expect(text).toBe("(no matching notes)")
})

test("export prints the raw JSON", async () => {
  await saveMemory({ "user:a": { ...NOTE, content: "fact a" } })
  const { code, text } = await runMemoryCli(["export"])
  expect(code).toBe(0)
  expect(JSON.parse(text)).toEqual({ "user:a": { ...NOTE, content: "fact a" } })
})

test("export with no store file prints an empty object", async () => {
  const { code, text } = await runMemoryCli(["export"])
  expect(code).toBe(0)
  expect(text).toBe("{}")
})

test("unknown or missing subcommand prints usage and exits 1", async () => {
  for (const argv of [[], ["nope"], ["forget"], ["list", "extra"]]) {
    const { code, text } = await runMemoryCli(argv)
    expect(code).toBe(1)
    expect(text).toContain("kaja memory list")
  }
})
