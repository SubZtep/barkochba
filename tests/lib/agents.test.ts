import { expect, test } from "bun:test"
import {
  type Agent,
  type AgentEvent,
  askUserTool,
  createSession,
  run,
  runCommandTool
} from "../../lib/agents"

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

function fakeAgent(script: FakeMessage[]): Agent {
  return {
    name: "Tester",
    model: "fake-model",
    tools: [askUserTool, runCommandTool],
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
