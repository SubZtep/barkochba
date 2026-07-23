import { afterEach, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// XDG_CONFIG_HOME is isolated too, since memory-store.ts can write
// config.memory.dbPath back into config.json on first successful open.
const dataDir = `${tmpdir()}/kaja-test-xdg-data-tools`
const configDir = `${tmpdir()}/kaja-test-xdg-config-tools`
process.env.XDG_DATA_HOME = dataDir
process.env.XDG_CONFIG_HOME = configDir

// tools/memory.ts pulls in lib/agents.ts -> lib/openai.ts, which reads
// config() at module load — config() hard-exits the process if config.json
// is missing, so this isolated config dir needs a minimal valid file (same
// fixture as tests/lib/agents.test.ts).
const configKajaDir = join(configDir, "kaja")
mkdirSync(configKajaDir, { recursive: true })
writeFileSync(
  join(configKajaDir, "config.json"),
  JSON.stringify({
    llm: { baseUrl: "http://localhost", apiKey: "x", model: "x" }
  })
)

const { saveMemory } = await import("../../lib/memory-store")
const { forgetNoteTool, listNotesTool, recallMemoryTool, rememberNoteTool } =
  await import("../../tools/memory")

afterEach(async () => {
  await saveMemory({})
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

  const result = (await recallMemoryTool.execute({
    query: "typescript"
  })) as string
  const lines = result.split("\n")
  expect(lines[0]).toStartWith("b [high]")
  expect(lines[1]).toStartWith("a [low]")
  expect(result).not.toContain("unrelated fact")
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
  expect(list).toContain("sticky-one [high, sticky]")
})

test("list_notes on an empty store", async () => {
  const result = await listNotesTool.execute({})
  expect(result).toBe("(no notes stored)")
})

test("recall_memory results carry importance, sticky, tags, and date metadata", async () => {
  await rememberNoteTool.execute({
    key: "user:style",
    content: "likes brevity",
    importance: "high",
    tags: ["user", "style"],
    sticky: true
  })
  const result = await recallMemoryTool.execute({ query: "brevity" })
  expect(result).toContain("user:style [high, sticky]")
  expect(result).toContain("(tags: user, style)")
  expect(result).toContain("(used ")
  expect(result).toContain(": likes brevity")
})

test("list_notes hides content by default and shows it with full: true", async () => {
  await rememberNoteTool.execute({
    key: "a",
    content: "the secret content",
    importance: "low",
    tags: ["x"]
  })
  const compact = await listNotesTool.execute({})
  expect(compact).toContain("a [low] (tags: x)")
  expect(compact).not.toContain("the secret content")

  const full = await listNotesTool.execute({ full: true })
  expect(full).toContain("the secret content")
})

test("recall_memory filters by tags (any-of)", async () => {
  await rememberNoteTool.execute({
    key: "a",
    content: "fact one",
    importance: "medium",
    tags: ["alpha"]
  })
  await rememberNoteTool.execute({
    key: "b",
    content: "fact two",
    importance: "medium",
    tags: ["beta"]
  })
  const result = await recallMemoryTool.execute({
    query: "fact",
    tags: ["alpha"]
  })
  expect(result).toContain("fact one")
  expect(result).not.toContain("fact two")
})

test("recall_memory filters by stickyOnly and minImportance", async () => {
  await rememberNoteTool.execute({
    key: "sticky-high",
    content: "shared fact",
    importance: "high",
    sticky: true
  })
  await rememberNoteTool.execute({
    key: "loose-low",
    content: "shared fact",
    importance: "low"
  })

  const sticky = await recallMemoryTool.execute({
    query: "shared",
    stickyOnly: true
  })
  expect(sticky).toContain("sticky-high")
  expect(sticky).not.toContain("loose-low")

  const important = await recallMemoryTool.execute({
    query: "shared",
    minImportance: "medium"
  })
  expect(important).toContain("sticky-high")
  expect(important).not.toContain("loose-low")
})

test("recall_memory with an empty query returns the filtered set ranked by importance", async () => {
  await rememberNoteTool.execute({
    key: "low-one",
    content: "minor",
    importance: "low",
    sticky: true
  })
  await rememberNoteTool.execute({
    key: "high-one",
    content: "major",
    importance: "high",
    sticky: true
  })
  await rememberNoteTool.execute({
    key: "loose",
    content: "not sticky",
    importance: "high"
  })

  const result = (await recallMemoryTool.execute({
    query: "",
    stickyOnly: true
  })) as string
  const lines = result.split("\n")
  expect(lines).toHaveLength(2)
  expect(lines[0]).toStartWith("high-one")
  expect(lines[1]).toStartWith("low-one")
})

test("forget_note deletes in bulk by tag", async () => {
  await rememberNoteTool.execute({
    key: "t1",
    content: "probe",
    importance: "low",
    tags: ["test"]
  })
  await rememberNoteTool.execute({
    key: "t2",
    content: "probe",
    importance: "low",
    tags: ["test"]
  })
  await rememberNoteTool.execute({
    key: "keep",
    content: "real",
    importance: "low"
  })

  const result = await forgetNoteTool.execute({ tag: "test" })
  expect(result).toContain("t1")
  expect(result).toContain("t2")

  const list = await listNotesTool.execute({})
  expect(list).toContain("keep")
  expect(list).not.toContain("t1")
})

test("forget_note deletes in bulk by key glob pattern", async () => {
  await rememberNoteTool.execute({
    key: "test:probe-a",
    content: "probe",
    importance: "low"
  })
  await rememberNoteTool.execute({
    key: "test:probe-b",
    content: "probe",
    importance: "low"
  })
  await rememberNoteTool.execute({
    key: "user:real",
    content: "real",
    importance: "low"
  })

  const result = await forgetNoteTool.execute({ pattern: "test:*" })
  expect(result).toContain("test:probe-a")
  expect(result).toContain("test:probe-b")

  const list = await listNotesTool.execute({})
  expect(list).toContain("user:real")
  expect(list).not.toContain("test:probe-a")
})

test("recall_memory with an empty query is uncapped unless limit is passed", async () => {
  for (let i = 0; i < 7; i++) {
    await rememberNoteTool.execute({
      key: `note-${i}`,
      content: `fact ${i}`,
      importance: "low"
    })
  }

  const all = (await recallMemoryTool.execute({ query: "" })) as string
  expect(all.split("\n")).toHaveLength(7)

  const capped = (await recallMemoryTool.execute({
    query: "",
    limit: 3
  })) as string
  expect(capped.split("\n")).toHaveLength(3)

  const keyword = (await recallMemoryTool.execute({
    query: "fact"
  })) as string
  expect(keyword.split("\n")).toHaveLength(5)
})

test("forget_note requires exactly one selector", async () => {
  expect(await forgetNoteTool.execute({})).toBe(
    "Provide exactly one of: key, tag, pattern."
  )
  expect(await forgetNoteTool.execute({ key: "a", tag: "b" })).toBe(
    "Provide exactly one of: key, tag, pattern."
  )
})
