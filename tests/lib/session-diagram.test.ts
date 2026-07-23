import { expect, test } from "bun:test"
import { sessionToMermaid } from "../../lib/session-diagram"
import type { PersistedSession } from "../../schemas/session"

function fixture(events: { type: string; [k: string]: unknown }[]) {
  return {
    id: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    persona: "kaja",
    model: "test-model",
    title: "test",
    session: { messages: [] },
    events
  } as PersistedSession
}

test("full conversation maps to a sequence diagram", () => {
  const out = sessionToMermaid(
    fixture([
      { type: "user", text: "What's the weather in London" },
      { type: "reasoning", text: "let me look that up" },
      {
        type: "tool_call",
        name: "web_search",
        arguments: '{"query":"London weather"}'
      },
      { type: "message", content: "Checking…" },
      { type: "ask_user", question: "Celsius or Fahrenheit?" },
      { type: "user", text: "celsius" },
      {
        type: "confirm_command",
        command: "curl wttr.in",
        description: "check"
      },
      { type: "final", content: "18°C and cloudy" },
      { type: "error", text: "model timed out" }
    ])
  )
  expect(out).toBe(
    [
      "sequenceDiagram",
      "  actor User",
      "  participant Kaja",
      "  participant web_search",
      "",
      "  User->>Kaja: What's the weather in London",
      "  Note over Kaja: thinking…",
      '  Kaja->>web_search: {"query":"London weather"}',
      "  Kaja-->>User: Checking…",
      "  Kaja-->>User: Celsius or Fahrenheit?",
      "  User->>Kaja: celsius",
      "  Kaja-->>User: $ curl wttr.in",
      "  Kaja-->>User: 18°C and cloudy",
      "  Kaja--xUser: model timed out"
    ].join("\n")
  )
})

test("tool participants are deduplicated and word-sanitized", () => {
  const out = sessionToMermaid(
    fixture([
      { type: "tool_call", name: "web_search", arguments: "{}" },
      { type: "tool_call", name: "web_search", arguments: "{}" },
      { type: "tool_call", name: "read file!", arguments: "{}" }
    ])
  )
  expect(out.match(/participant web_search/g)).toHaveLength(1)
  expect(out).toContain("participant read_file_")
  expect(out).toContain("Kaja->>read_file_:")
})

test("labels are flattened, truncated, and mermaid-escaped", () => {
  const out = sessionToMermaid(
    fixture([
      { type: "user", text: "line one\nline two" },
      { type: "user", text: "x".repeat(80) },
      { type: "user", text: "a # b ; c" }
    ])
  )
  expect(out).toContain("User->>Kaja: line one line two")
  expect(out).toContain(`User->>Kaja: ${"x".repeat(59)}…`)
  expect(out).toContain("User->>Kaja: a #35; b #59; c")
})

test("empty final content and unknown event types are skipped", () => {
  const out = sessionToMermaid(
    fixture([
      { type: "user", text: "hi" },
      { type: "final", content: null },
      { type: "someday_new_type", text: "ignored" }
    ])
  )
  const body = out.split("\n\n")[1]!
  expect(body).toBe("  User->>Kaja: hi")
})
