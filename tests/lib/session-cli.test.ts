import { afterEach, expect, test } from "bun:test"
import { tmpdir } from "node:os"

// XDG_CONFIG_HOME is isolated too, since memory-store.ts can write
// config.memory.dbPath back into config.json on first successful open.
process.env.XDG_DATA_HOME = `${tmpdir()}/kaja-test-xdg-data-session-cli`
process.env.XDG_CONFIG_HOME = `${tmpdir()}/kaja-test-xdg-config-session-cli`

const { getDb } = await import("../../lib/memory-store")
const { createSessionRow } = await import("../../lib/session-store")
const { runSessionCli } = await import("../../lib/session-cli")

afterEach(async () => {
  const db = await getDb()
  db.exec("DELETE FROM sessions")
})

test("list on an empty store", async () => {
  const { code, text } = await runSessionCli(["list"])
  expect(code).toBe(0)
  expect(text).toBe("(no sessions recorded)")
})

test("list prints one line per session, newest first", async () => {
  const first = await createSessionRow({
    persona: "kaja",
    model: "test-model",
    title: "What's the weather like",
    session: { messages: [] },
    events: [{ type: "user", text: "What's the weather like" }]
  })
  await Bun.sleep(2)
  const second = await createSessionRow({
    persona: "barkochba",
    model: "other-model",
    title: "Guess my animal",
    session: { messages: [] },
    events: [{ type: "user", text: "Guess my animal" }]
  })

  const { code, text } = await runSessionCli(["list"])
  expect(code).toBe(0)
  const lines = text.split("\n")
  expect(lines).toHaveLength(2)
  expect(lines[0]).toContain(`#${second}`)
  expect(lines[0]).toContain("barkochba")
  expect(lines[0]).toContain("Guess my animal")
  expect(lines[1]).toContain(`#${first}`)
  expect(lines[1]).toContain("kaja")
  expect(lines[1]).toContain("What's the weather like")
})

test("diagram prints a mermaid sequence diagram for the session", async () => {
  const id = await createSessionRow({
    persona: "kaja",
    model: "test-model",
    title: "hi",
    session: { messages: [] },
    events: [
      { type: "user", text: "hi" },
      { type: "final", content: "hello!" }
    ]
  })
  const { code, text } = await runSessionCli(["diagram", String(id)])
  expect(code).toBe(0)
  expect(text).toContain("sequenceDiagram")
  expect(text).toContain("User->>Kaja: hi")
  expect(text).toContain("Kaja-->>User: hello!")
})

test("diagram with a missing or invalid id exits 1", async () => {
  for (const arg of ["12345", "abc"]) {
    const { code, text } = await runSessionCli(["diagram", arg])
    expect(code).toBe(1)
    expect(text).toBe(`Session not found: ${arg}`)
  }
})

test("unknown or missing subcommand prints usage and exits 1", async () => {
  for (const argv of [[], ["nope"], ["list", "extra"], ["diagram"]]) {
    const { code, text } = await runSessionCli(argv)
    expect(code).toBe(1)
    expect(text).toContain("kaja session list")
  }
})
