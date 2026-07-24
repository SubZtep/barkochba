import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Agent, AgentEvent } from "../../lib/agents"

// XDG_DATA_HOME/XDG_CONFIG_HOME are read fresh on every call by
// lib/config.ts and lib/memory-store.ts (not cached at module load), so
// setting them before each test isolates this file from the real
// ~/.local/share/kaja and ~/.config/kaja even though other test files run
// in the same `bun test` process and may set these vars between tests.
// Set before any import: lib/openai.ts does `const { llm } = await config()`
// at its own module top level (transitively reached from lib/agents.ts), so
// a *static* import of lib/agents.ts here would resolve before this file's
// own body — including these env vars — ever ran. Dynamic imports below
// keep the sequencing: env vars and the config.json fixture are in place
// before lib/agents.ts (and everything it pulls in) is ever evaluated.
const dataDir = `${tmpdir()}/kaja-test-xdg-data-agents`
const configDir = `${tmpdir()}/kaja-test-xdg-config-agents`
process.env.XDG_DATA_HOME = dataDir
process.env.XDG_CONFIG_HOME = configDir
// getPaths() appends "-dev" to the "kaja" subdirectory when
// NODE_ENV=development, which would miss the fixture below if inherited
// from the invoking shell — pin it so the hardcoded "kaja" path always
// matches.
process.env.NODE_ENV = "test"

// config() hard-exits the process if config.json is missing, so this
// isolated config dir needs a minimal valid file — no `location` block, so
// run() never attempts a real network geo lookup.
const configKajaDir = join(configDir, "kaja")
mkdirSync(configKajaDir, { recursive: true })
writeFileSync(
  join(configKajaDir, "config.json"),
  JSON.stringify({
    llm: { baseUrl: "http://localhost", apiKey: "x", model: "x" }
  })
)

const { invalidateConfigCache } = await import("../../lib/config")
const { askUserTool, createSession, run, runCommandTool } = await import(
  "../../lib/agents"
)
const { saveMemory } = await import("../../lib/memory-store")
const { rememberNoteTool } = await import("../../tools/memory")

// config()'s parsed *contents* are cached in-process on top of the path
// resolution (see lib/config.ts) — invalidate before every test in case
// another test file's process-wide cache last populated it with a
// different config (e.g. a real location block, triggering a real network
// call from run()).
beforeEach(() => {
  process.env.XDG_DATA_HOME = dataDir
  process.env.XDG_CONFIG_HOME = configDir
  invalidateConfigCache()
})

type FakeMessage = {
  content: string | null
  tool_calls?: {
    id: string
    type: "function"
    function: { name: string; arguments: string }
  }[]
}

/**
 * A stand-in for the OpenAI client's `chat.completions.stream()`: each call
 * pops the next scripted message, replays its content as a single delta
 * chunk, and returns it whole from `finalChatCompletion()`.
 */
function fakeClient(script: FakeMessage[]) {
  let i = 0
  return {
    chat: {
      completions: {
        stream: () => {
          const message = script[i++]
          if (!message) throw new Error("fake script exhausted")
          return {
            async *[Symbol.asyncIterator]() {
              if (message.content)
                yield { choices: [{ delta: { content: message.content } }] }
            },
            finalChatCompletion: async () => ({
              choices: [{ message: { role: "assistant", ...message } }]
            })
          }
        }
      }
    }
  }
}

function fakeAgent(
  script: FakeMessage[],
  extraTools: Agent["tools"] = []
): Agent {
  return {
    name: "Tester",
    model: "fake-model",
    tools: [askUserTool, runCommandTool, ...extraTools],
    client: fakeClient(script)
  } as unknown as Agent
}

async function collect(agent: Agent) {
  const events: AgentEvent[] = []
  for await (const event of run(agent, "is it a pet?", createSession())) {
    events.push(event)
  }
  return events
}

afterEach(async () => {
  await saveMemory({})
})

test("content alongside an ask_user call is yielded as a message event", async () => {
  const agent = fakeAgent([
    {
      content: "No, it's not a pet.",
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: {
            name: "ask_user",
            arguments: JSON.stringify({ question: "Question 4?" })
          }
        }
      ]
    }
  ])

  const events = await collect(agent)
  const finalized = events.filter((e) => e.type !== "delta")
  expect(finalized).toEqual([
    { type: "message", content: "No, it's not a pet." },
    { type: "ask_user", question: "Question 4?" }
  ])
})

test("content without tool calls still arrives as final only", async () => {
  const agent = fakeAgent([{ content: "The answer was a platypus." }])

  const events = await collect(agent)
  const finalized = events.filter((e) => e.type !== "delta")
  expect(finalized).toEqual([
    { type: "final", content: "The answer was a platypus." }
  ])
})

test("run_command call is intercepted and yielded as confirm_command", async () => {
  const agent = fakeAgent([
    {
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: {
            name: "run_command",
            arguments: JSON.stringify({
              command: "echo hi",
              description: "Say hi"
            })
          }
        }
      ]
    }
  ])

  const events = await collect(agent)
  const finalized = events.filter((e) => e.type !== "delta")
  expect(finalized).toEqual([
    { type: "confirm_command", command: "echo hi", description: "Say hi" }
  ])
})

test("run_command with mutates: false runs immediately, no confirm_command", async () => {
  const agent = fakeAgent([
    {
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: {
            name: "run_command",
            arguments: JSON.stringify({
              command: "echo hi",
              description: "Say hi",
              mutates: false
            })
          }
        }
      ]
    },
    { content: "Done." }
  ])

  const events = await collect(agent)
  const finalized = events.filter((e) => e.type !== "delta")
  expect(finalized).toEqual([{ type: "final", content: "Done." }])
})

test("run_command with mutates: false but a dangerous command still confirms", async () => {
  const agent = fakeAgent([
    {
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: {
            name: "run_command",
            arguments: JSON.stringify({
              command: "sudo rm -rf /tmp/x",
              description: "Clean up",
              mutates: false
            })
          }
        }
      ]
    }
  ])

  const events = await collect(agent)
  const finalized = events.filter((e) => e.type !== "delta")
  expect(finalized).toEqual([
    {
      type: "confirm_command",
      command: "sudo rm -rf /tmp/x",
      description: "Clean up"
    }
  ])
})

test("resuming after run_command threads the result back as a tool response", async () => {
  const agent = fakeAgent([
    {
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: {
            name: "run_command",
            arguments: JSON.stringify({
              command: "echo hi",
              description: "Say hi"
            })
          }
        }
      ]
    },
    { content: "Done." }
  ])

  const session = createSession()
  const first: AgentEvent[] = []
  for await (const event of run(agent, "play a beep", session)) {
    first.push(event)
  }
  expect(session.pendingRunCommandId).toBe("call_1")

  const second: AgentEvent[] = []
  for await (const event of run(agent, "Exit code: 0", session)) {
    second.push(event)
  }
  expect(session.pendingRunCommandId).toBeUndefined()
  expect(second.filter((e) => e.type !== "delta")).toEqual([
    { type: "final", content: "Done." }
  ])
  expect(session.messages.some((m) => m.role === "tool")).toBe(true)
})

test("sticky notes are injected into the first system message, non-sticky ones aren't", async () => {
  const now = "2026-01-01T00:00:00.000Z"
  await saveMemory({
    "user:sticky-fact": {
      content: "always mentioned",
      importance: "high",
      tags: [],
      sticky: true,
      createdAt: now,
      lastUsedAt: now,
      useCount: 0
    },
    "user:quiet-fact": {
      content: "only on recall",
      importance: "low",
      tags: [],
      sticky: false,
      createdAt: now,
      lastUsedAt: now,
      useCount: 0
    }
  })

  const agent = fakeAgent([{ content: "Hi." }], [rememberNoteTool])
  const session = createSession()
  for await (const _ of run(agent, "hello", session)) {
    // drain
  }

  const system = session.messages[0]
  expect(system?.role).toBe("system")
  const content = (system as { content: string }).content
  expect(content).toContain("always mentioned")
  expect(content).not.toContain("only on recall")
})

test("no sticky-note block when there are no sticky notes", async () => {
  const agent = fakeAgent([{ content: "Hi." }], [rememberNoteTool])
  const session = createSession()
  for await (const _ of run(agent, "hello", session)) {
    // drain
  }

  const system = session.messages[0]
  const content = (system as { content: string }).content
  expect(content).not.toContain("Known context about this user/project")
})
