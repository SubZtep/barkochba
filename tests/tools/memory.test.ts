import { afterEach, expect, test } from "bun:test"
import { rm } from "node:fs/promises"

process.env.XDG_DATA_HOME = `${import.meta.dir}/../../.tmp-test-xdg-data-tools`

const { memoryPath } = await import("../../lib/memory-store")
const { forgetNoteTool, listNotesTool, recallMemoryTool, rememberNoteTool } =
  await import("../../tools/memory")

afterEach(async () => {
  await rm(memoryPath, { force: true })
})

test("remember_note creates a new note", async () => {
  const result = await rememberNoteTool.execute({
    key: "user:name",
    content: "Andras",
    importance: "high"
  })
  expect(result).toContain("user:name")
  const list = await listNotesTool.execute({})
  expect(list).toContain("user:name")
  expect(list).toContain("[high]")
})

test("remember_note upserts by key, preserving createdAt", async () => {
  await rememberNoteTool.execute({
    key: "user:name",
    content: "Andras",
    importance: "low"
  })
  const first = (await import("../../lib/memory-store")).loadMemory
  const before = await first()
  const createdAt = before["user:name"]!.createdAt

  await new Promise((r) => setTimeout(r, 5))
  await rememberNoteTool.execute({
    key: "user:name",
    content: "Andras Serfozo",
    importance: "high"
  })

  const after = await first()
  expect(Object.keys(after)).toHaveLength(1)
  expect(after["user:name"]!.content).toBe("Andras Serfozo")
  expect(after["user:name"]!.importance).toBe("high")
  expect(after["user:name"]!.createdAt).toBe(createdAt)
})

test("recall_memory scores and orders by relevance and importance", async () => {
  await rememberNoteTool.execute({
    key: "a",
    content: "likes typescript",
    importance: "low"
  })
  await rememberNoteTool.execute({
    key: "b",
    content: "likes typescript a lot",
    importance: "high"
  })
  await rememberNoteTool.execute({
    key: "c",
    content: "unrelated fact",
    importance: "high"
  })

  const result = await recallMemoryTool.execute({ query: "typescript" })
  const lines = result.split("\n")
  expect(lines[0]).toContain("b:")
  expect(lines[1]).toContain("a:")
  expect(result).not.toContain("c:")
})

test("recall_memory returns a no-match message", async () => {
  const result = await recallMemoryTool.execute({ query: "nonexistent" })
  expect(result).toBe("(no matching notes)")
})

test("forget_note removes the right key", async () => {
  await rememberNoteTool.execute({
    key: "keep",
    content: "keep me",
    importance: "medium"
  })
  await rememberNoteTool.execute({
    key: "drop",
    content: "drop me",
    importance: "medium"
  })

  const result = await forgetNoteTool.execute({ key: "drop" })
  expect(result).toContain("drop")

  const list = await listNotesTool.execute({})
  expect(list).toContain("keep")
  expect(list).not.toContain("drop")
})

test("forget_note on a missing key returns a message instead of throwing", async () => {
  const result = await forgetNoteTool.execute({ key: "nope" })
  expect(result).toBe("(no note with that key)")
})

test("list_notes marks sticky notes", async () => {
  await rememberNoteTool.execute({
    key: "sticky-one",
    content: "always shown",
    importance: "high",
    sticky: true
  })
  const list = await listNotesTool.execute({})
  expect(list).toContain("* [high] sticky-one")
})

test("list_notes on an empty store", async () => {
  const result = await listNotesTool.execute({})
  expect(result).toBe("(no notes stored)")
})
