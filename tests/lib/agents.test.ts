import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Agent, AgentEvent } from "../../lib/agents"
import type { Persona } from "../../schemas/personas"

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
const {
  askUserTool,
  buildSystemPrompt,
  createSession,
  run,
  runCommandTool,
  switchPersonaTool,
  tool
} = await import("../../lib/agents")
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

test("run() threads the owner parameter to a tool's execute as ctx.owner", async () => {
  let capturedOwner: string | null | undefined
  const captureOwnerTool = tool<Record<string, never>>({
    name: "capture_owner",
    description: "test tool",
    parameters: { type: "object", properties: {} },
    execute: async (_args, ctx) => {
      capturedOwner = ctx?.owner
      return "ok"
    }
  })
  const agent = fakeAgent(
    [
      {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "capture_owner", arguments: "{}" }
          }
        ]
      },
      { content: "done" }
    ],
    [captureOwnerTool]
  )

  const events: AgentEvent[] = []
  for await (const event of run(agent, "hi", createSession(), "telegram:42")) {
    events.push(event)
  }

  expect(capturedOwner).toBe("telegram:42")
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

test("dataset instructions block appears only when agent.dataset is set and the tool is present", async () => {
  const { datasetInfoTool } = await import("../../tools/dataset-info")
  const datasetsDir = join(configKajaDir, "datasets")
  mkdirSync(datasetsDir, { recursive: true })
  writeFileSync(
    join(datasetsDir, "onboarding.json"),
    JSON.stringify({
      label: "Onboarding",
      fields: [{ name: "favorite_color", prompt: "Favorite color?" }]
    })
  )

  const withDataset = {
    ...fakeAgent([{ content: "Hi." }], [datasetInfoTool]),
    dataset: "onboarding"
  } as Agent
  const session1 = createSession()
  for await (const _ of run(withDataset, "hello", session1)) {
    // drain
  }
  const content1 = (session1.messages[0] as { content: string }).content
  expect(content1).toContain("Onboarding")
  expect(content1).toContain("onboarding")

  const withoutDatasetTool = {
    ...fakeAgent([{ content: "Hi." }]),
    dataset: "onboarding"
  } as Agent
  const session2 = createSession()
  for await (const _ of run(withoutDatasetTool, "hello", session2)) {
    // drain
  }
  const content2 = (session2.messages[0] as { content: string } | undefined)
    ?.content
  expect(content2 ?? "").not.toContain("Onboarding")
})

const personaA: Persona = {
  id: "a",
  label: "Persona A",
  instructions: "You are persona A.",
  when: "topic A comes up"
}
const personaB: Persona = {
  id: "b",
  label: "Persona B",
  instructions: "You are persona B.",
  temperature: 0.5,
  when: "topic B comes up"
}

/** A fakeAgent carrying a persona roster, as the switch_persona path needs. */
function fakePersonaAgent(script: FakeMessage[]): Agent {
  return {
    ...fakeAgent(script, [switchPersonaTool]),
    instructions: personaA.instructions,
    personas: [personaA, personaB],
    models: [],
    personaId: personaA.id
  } as unknown as Agent
}

test("switch_persona rewrites the system message in place and continues the turn", async () => {
  const agent = fakePersonaAgent([
    {
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: {
            name: "switch_persona",
            arguments: JSON.stringify({ persona: "b", reason: "topic B" })
          }
        }
      ]
    },
    { content: "Continuing as B." }
  ])

  const session = createSession()
  const events: AgentEvent[] = []
  for await (const event of run(agent, "let's talk about topic B", session)) {
    events.push(event)
  }

  const finalized = events.filter((e) => e.type !== "delta")
  expect(finalized).toEqual([
    {
      type: "tool_call",
      name: "switch_persona",
      arguments: JSON.stringify({ persona: "b", reason: "topic B" })
    },
    { type: "persona_switch", personaId: "b", label: "Persona B" },
    { type: "final", content: "Continuing as B." }
  ])

  expect(agent.personaId).toBe("b")
  expect(agent.sampling).toEqual({ temperature: 0.5 })

  const system = session.messages[0]
  expect(system?.role).toBe("system")
  const content = (system as { content: string }).content
  expect(content).toContain("You are persona B.")
  expect(content).not.toContain("You are persona A.")

  const toolResponse = session.messages.find((m) => m.role === "tool")
  expect((toolResponse as { content: string }).content).toContain(
    'Persona switched to "Persona B"'
  )
})

test("switch_persona with an unknown id returns an error result and leaves the prompt untouched", async () => {
  const agent = fakePersonaAgent([
    {
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: {
            name: "switch_persona",
            arguments: JSON.stringify({ persona: "nope" })
          }
        }
      ]
    },
    { content: "Staying as A." }
  ])

  const session = createSession()
  const events: AgentEvent[] = []
  for await (const event of run(agent, "hello", session)) {
    events.push(event)
  }

  expect(events.some((e) => e.type === "persona_switch")).toBe(false)
  expect(agent.personaId).toBe("a")

  const content = (session.messages[0] as { content: string }).content
  expect(content).toContain("You are persona A.")

  const toolResponse = session.messages.find((m) => m.role === "tool")
  expect((toolResponse as { content: string }).content).toContain(
    'Unknown persona "nope"'
  )
})

test("## Personas roster appears only with the switch_persona tool and more than one persona", async () => {
  const withRoster = fakePersonaAgent([])
  const prompt = await buildSystemPrompt(withRoster)
  expect(prompt).toContain("## Personas")
  expect(prompt).toContain('Current persona: "a"')
  expect(prompt).toContain("- b (Persona B): use when topic B comes up")

  const withoutTool = {
    ...fakeAgent([]),
    personas: [personaA, personaB],
    personaId: personaA.id
  } as Agent
  expect((await buildSystemPrompt(withoutTool)) ?? "").not.toContain(
    "## Personas"
  )

  const singlePersona = {
    ...fakeAgent([], [switchPersonaTool]),
    personas: [personaA],
    personaId: personaA.id
  } as Agent
  expect((await buildSystemPrompt(singlePersona)) ?? "").not.toContain(
    "## Personas"
  )
})
