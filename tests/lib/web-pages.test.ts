import { expect, test } from "bun:test"
import {
  escapeHtml,
  maskSecrets,
  notesPage,
  sessionPage,
  sessionsPage
} from "../../lib/web-pages"
import type { MemoryNote } from "../../schemas/memory"

const note = (content: string): MemoryNote => ({
  content,
  importance: "high",
  tags: ["user"],
  sticky: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  lastUsedAt: "2026-01-02T00:00:00.000Z",
  useCount: 3
})

test("escapeHtml neutralizes markup characters", () => {
  expect(escapeHtml(`<script>alert("x&y")</script>'`)).toBe(
    "&lt;script&gt;alert(&quot;x&amp;y&quot;)&lt;/script&gt;&#39;"
  )
})

test("maskSecrets masks apiKey/token values recursively, leaves the rest", () => {
  expect(
    maskSecrets({
      llm: { baseUrl: "https://api.example.com", apiKey: "sk-secret-value" },
      telegram: { botToken: "123456:ABCDEF", allowedUserIds: [42] }
    })
  ).toEqual({
    llm: { baseUrl: "https://api.example.com", apiKey: "sk-s…" },
    telegram: { botToken: "1234…", allowedUserIds: [42] }
  })
})

test("notesPage renders rows and escapes hostile content", () => {
  const html = notesPage({
    "test:hostile": note(`<img src=x onerror=alert(1)>`)
  })
  expect(html).toContain("test:hostile")
  expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;")
  expect(html).not.toContain("<img src=x")
  expect(html).toContain("high, sticky")
})

test("notesPage shows an empty state", () => {
  expect(notesPage({})).toContain("No notes.")
})

test("sessionsPage renders meta rows with links and delete forms", () => {
  const html = sessionsPage([
    {
      id: 7,
      createdAt: "2026-01-01T10:00:00.000Z",
      updatedAt: "2026-01-01T11:30:00.000Z",
      persona: "kaja",
      model: "test-model",
      title: "Hello <world>",
      owner: null
    }
  ])
  expect(html).toContain('href="/sessions/7"')
  expect(html).toContain("Hello &lt;world&gt;")
  expect(html).toContain('action="/sessions/7/delete"')
  expect(html).toContain("terminal")
})

test("sessionPage renders the payload for every timeline event type", () => {
  const html = sessionPage({
    id: 62,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    persona: "kaja",
    model: "test-model",
    title: "mixed events",
    owner: null,
    session: { messages: [] },
    events: [
      { type: "user", text: "/start" },
      { type: "message", content: "Indítom a játékot." },
      {
        type: "tool_call",
        name: "like_or_not_game",
        arguments: '{"action":"list_topics"}'
      },
      { type: "tool_image", path: "/tmp/x.png" },
      { type: "display_image", url: "https://example.com/x.png", alt: "a cat" },
      { type: "ask_user", question: "Which topic?" },
      {
        type: "confirm_command",
        command: "rm -rf /tmp/x",
        description: "cleanup"
      },
      { type: "final", content: "done" }
    ]
  })
  expect(html).toContain("/start")
  expect(html).toContain("Indítom a játékot.")
  expect(html).toContain("like_or_not_game")
  expect(html).toContain("{&quot;action&quot;:&quot;list_topics&quot;}")
  expect(html).toContain("/tmp/x.png")
  expect(html).toContain("a cat (https://example.com/x.png)")
  expect(html).toContain("Which topic?")
  expect(html).toContain("rm -rf /tmp/x")
  expect(html).toContain("cleanup")
  expect(html).toContain("done")
})
