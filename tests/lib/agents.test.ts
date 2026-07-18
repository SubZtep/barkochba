import { afterEach, expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import type { Agent, AgentEvent } from "../../lib/agents"

// lib/agents.ts loads memory via lib/memory-store.ts, whose path is resolved
// once at import time from XDG_DATA_HOME — set before any import touches it.
process.env.XDG_DATA_HOME = `${import.meta.dir}/../../.tmp-test-xdg-data-agents`

const { memoryPath, saveMemory } = await import("../../lib/memory-store")
const { askUserTool, createSession, run, runCommandTool } = await import(
  "../../lib/agents"
)
const { rememberNoteTool } = await import("../../tools/memory")

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
  await rm(memoryPath, { force: true })
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
