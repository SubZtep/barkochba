import { expect, test } from "bun:test"
import {
  type Agent,
  type AgentEvent,
  askUserTool,
  createSession,
  run
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
    tools: [askUserTool],
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
