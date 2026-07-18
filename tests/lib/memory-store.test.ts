import { afterEach, beforeAll, expect, test } from "bun:test"
import { rm } from "node:fs/promises"

// memoryPath is resolved once at module load via envPaths(), which reads
// XDG_DATA_HOME — set before importing so the store never touches the real
// ~/.local/share/kaja/memory.json.
process.env.XDG_DATA_HOME = `${import.meta.dir}/../../.tmp-test-xdg-data`

const { loadMemory, memoryPath, saveMemory } = await import(
  "../../lib/memory-store"
)

afterEach(async () => {
  await rm(memoryPath, { force: true })
  await rm(`${memoryPath}.tmp`, { force: true })
})

beforeAll(async () => {
  await Bun.write(memoryPath, "placeholder")
  await rm(memoryPath, { force: true })
})

test("loadMemory returns {} when the file doesn't exist", async () => {
  expect(await loadMemory()).toEqual({})
})

test("loadMemory returns {} for a corrupt file instead of throwing", async () => {
  await Bun.write(memoryPath, "not json")
  expect(await loadMemory()).toEqual({})
})

test("saveMemory then loadMemory round-trips", async () => {
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

test("saveMemory writes atomically (no leftover .tmp file)", async () => {
  await saveMemory({})
  expect(await Bun.file(`${memoryPath}.tmp`).exists()).toBe(false)
})
