import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadMemory, saveMemory } from "../../lib/memory-store"
import { createSessionRow, loadSessionRow } from "../../lib/session-store"
import { startWebServer } from "../../lib/web-cli"

// Same per-file XDG isolation pattern as memory-store.test.ts: the paths are
// read fresh on every call, so pointing the env at a temp dir before the
// first store call keeps the whole file off the real ~/.local/share/kaja.
const configDir = `${tmpdir()}/kaja-test-web-xdg-config`
process.env.XDG_DATA_HOME = `${tmpdir()}/kaja-test-web-xdg-data`
process.env.XDG_CONFIG_HOME = configDir

// /personas dynamically imports lib/agents.ts (see web-cli.ts), which pulls
// in lib/openai.ts's top-level `await config()` — that hard-exits without a
// config.json, so a real one must exist before that route is ever hit.
const configKajaDir = join(configDir, "kaja")
mkdirSync(configKajaDir, { recursive: true })
writeFileSync(
  join(configKajaDir, "config.json"),
  JSON.stringify({
    llm: { baseUrl: "http://localhost", apiKey: "x", model: "x" }
  })
)

let server: ReturnType<typeof startWebServer>
let base: string
let sessionId: number

beforeAll(async () => {
  await saveMemory({
    "test:web": {
      content: "a fact",
      importance: "low",
      tags: [],
      sticky: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: "2026-01-01T00:00:00.000Z",
      useCount: 0
    }
  })
  sessionId = await createSessionRow({
    persona: "kaja",
    model: "test-model",
    title: "web test session",
    owner: null,
    session: { messages: [] },
    events: [{ type: "user", text: "hello" }]
  })
  server = startWebServer(0)
  base = server.url.href.replace(/\/$/, "")
})

afterAll(async () => {
  await server?.stop(true)
  await saveMemory({})
})

test("GET pages respond 200", async () => {
  for (const path of [
    "/",
    "/personas",
    "/notes",
    "/sessions",
    `/sessions/${sessionId}`,
    "/game"
  ]) {
    const res = await fetch(`${base}${path}`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain("<nav>")
  }
})

test("personas page shows each persona's assembled system prompt", async () => {
  const body = await (await fetch(`${base}/personas`)).text()
  // Default template personas (docs/config/personas/), each should
  // carry the ask_user contract since every preview agent gets that tool.
  expect(body).toContain("Barkochba guesser")
  expect(body).toContain("call the ask_user tool")
})

test("session detail renders the timeline and title", async () => {
  const body = await (await fetch(`${base}/sessions/${sessionId}`)).text()
  expect(body).toContain("web test session")
  expect(body).toContain("hello")
})

test("unknown routes and missing sessions 404", async () => {
  expect((await fetch(`${base}/nope`)).status).toBe(404)
  expect((await fetch(`${base}/sessions/99999`)).status).toBe(404)
})

test("POST /notes/delete removes the note and redirects", async () => {
  const form = new FormData()
  form.set("key", "test:web")
  const res = await fetch(`${base}/notes/delete`, {
    method: "POST",
    body: form,
    redirect: "manual"
  })
  expect(res.status).toBe(303)
  expect(res.headers.get("location")).toBe("/notes")
  expect(await loadMemory()).toEqual({})
})

test("POST /sessions/:id/delete removes the session and redirects", async () => {
  const res = await fetch(`${base}/sessions/${sessionId}/delete`, {
    method: "POST",
    redirect: "manual"
  })
  expect(res.status).toBe(303)
  expect(res.headers.get("location")).toBe("/sessions")
  expect(await loadSessionRow(sessionId)).toBeUndefined()
})
