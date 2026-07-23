import { afterEach, expect, test } from "bun:test"
import { tmpdir } from "node:os"

// XDG_CONFIG_HOME is isolated too, since memory-store.ts can write
// config.memory.dbPath back into config.json on first successful open.
process.env.XDG_DATA_HOME = `${tmpdir()}/kaja-test-xdg-data-session`
process.env.XDG_CONFIG_HOME = `${tmpdir()}/kaja-test-xdg-config-session`

const { getDb } = await import("../../lib/memory-store")
const {
  createSessionRow,
  listSessions,
  loadLatestSessionRow,
  loadPromptHistory,
  loadSessionRow,
  updateSessionRow
} = await import("../../lib/session-store")

const SESSION = {
  messages: [
    { role: "system", content: "be helpful" },
    { role: "user", content: "hi" }
  ]
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    persona: "kaja",
    model: "test-model",
    title: "hi",
    session: SESSION,
    events: [{ type: "user", text: "hi" }],
    ...overrides
  }
}

afterEach(async () => {
  const db = await getDb()
  db.exec("DELETE FROM sessions")
})

test("create then load round-trips, including pending tool-call ids", async () => {
  const id = await createSessionRow(
    row({
      session: { ...SESSION, pendingAskUserId: "call_1" },
      events: [
        { type: "user", text: "hi" },
        { type: "ask_user", question: "why?" }
      ]
    })
  )
  const loaded = await loadSessionRow(id)
  expect(loaded).toBeDefined()
  expect(loaded!.id).toBe(id)
  expect(loaded!.persona).toBe("kaja")
  expect(loaded!.model).toBe("test-model")
  expect(loaded!.title).toBe("hi")
  expect(loaded!.session.messages).toEqual(SESSION.messages)
  expect(loaded!.session.pendingAskUserId).toBe("call_1")
  expect(loaded!.events).toEqual([
    { type: "user", text: "hi" },
    { type: "ask_user", question: "why?" }
  ])
})

test("update bumps updatedAt and loadLatestSessionRow follows it", async () => {
  const first = await createSessionRow(row({ title: "first" }))
  await Bun.sleep(2)
  const second = await createSessionRow(row({ title: "second" }))
  expect((await loadLatestSessionRow())!.id).toBe(second)

  const before = (await loadSessionRow(first))!.updatedAt
  await Bun.sleep(2)
  await updateSessionRow(first, row({ model: "other-model" }))
  const after = (await loadSessionRow(first))!
  expect(after.updatedAt > before).toBe(true)
  expect(after.model).toBe("other-model")
  // the freshly updated (old) session is "latest" again
  expect((await loadLatestSessionRow())!.id).toBe(first)
})

test("loadSessionRow returns undefined for a missing id", async () => {
  expect(await loadSessionRow(12345)).toBeUndefined()
})

test("a corrupt row loads as undefined instead of crashing", async () => {
  const id = await createSessionRow(row())
  const db = await getDb()
  db.query("UPDATE sessions SET session = 'not json' WHERE id = ?").run(id)
  expect(await loadSessionRow(id)).toBeUndefined()
})

test("listSessions is newest first and carries no payload blobs", async () => {
  const a = await createSessionRow(row({ title: "a" }))
  await Bun.sleep(2)
  const b = await createSessionRow(row({ title: "b" }))
  const list = await listSessions()
  expect(list.map((s) => s.id)).toEqual([b, a])
  expect(list[0]).not.toHaveProperty("session")
  expect(list[0]).not.toHaveProperty("events")
  expect(list[1]!.title).toBe("a")
})

test("loadPromptHistory: newest first across sessions, user events only, consecutive dupes collapsed", async () => {
  await createSessionRow(
    row({
      events: [
        { type: "user", text: "alpha" },
        { type: "message", content: "not a prompt" },
        { type: "user", text: "beta" }
      ]
    })
  )
  await createSessionRow(
    row({
      events: [
        { type: "user", text: "beta" },
        { type: "user", text: "gamma" }
      ]
    })
  )
  // newest session's newest prompt first; "beta" appears once at the seam
  expect(await loadPromptHistory()).toEqual(["gamma", "beta", "alpha"])
  expect(await loadPromptHistory(2)).toEqual(["gamma", "beta"])
})
