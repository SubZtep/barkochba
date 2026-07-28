import { beforeEach, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Agent, Tool } from "../../lib/agents"
import type {
  InlineKeyboardLike,
  TelegramSender
} from "../../lib/telegram-driver"
import type { Persona } from "../../schemas/personas"

// Same isolation/dynamic-import discipline as tests/lib/agents.test.ts: env
// vars and a minimal config.json fixture must be in place before
// lib/agents.ts (transitively pulled in by lib/telegram-driver.ts) is ever
// evaluated, since lib/openai.ts reads config() at its own module top level.
const dataDir = `${tmpdir()}/kaja-test-xdg-data-telegram-driver`
const configDir = `${tmpdir()}/kaja-test-xdg-config-telegram-driver`
process.env.XDG_DATA_HOME = dataDir
process.env.XDG_CONFIG_HOME = configDir
process.env.NODE_ENV = "test"

const configKajaDir = join(configDir, "kaja")
mkdirSync(configKajaDir, { recursive: true })
writeFileSync(
  join(configKajaDir, "config.json"),
  JSON.stringify({
    llm: { baseUrl: "http://localhost", apiKey: "x", model: "x" }
  })
)

const { invalidateConfigCache } = await import("../../lib/config")
const { askUserTool, runCommandTool, tool } = await import("../../lib/agents")
const { getDb } = await import("../../lib/memory-store")
const { createSessionRow, loadLatestSessionRowForOwner } = await import(
  "../../lib/session-store"
)
const { telegramOwner } = await import("../../schemas/session")
const { createTelegramDriver } = await import("../../lib/telegram-driver")
const { t } = await import("../../lib/i18n")

beforeEach(async () => {
  process.env.XDG_DATA_HOME = dataDir
  process.env.XDG_CONFIG_HOME = configDir
  invalidateConfigCache()
  const db = await getDb()
  db.exec("DELETE FROM sessions")
})

type FakeMessage = {
  content: string | null
  tool_calls?: {
    id: string
    type: "function"
    function: { name: string; arguments: string }
  }[]
}

/** Mirrors tests/lib/agents.test.ts's fakeClient/fakeAgent exactly. */
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
  extraTools: Tool<never>[] = []
): Agent {
  return {
    name: "Tester",
    model: "fake-model",
    tools: [askUserTool, runCommandTool, ...extraTools],
    client: fakeClient(script)
  } as unknown as Agent
}

const persona: Persona = { id: "kaja", label: "Kaja" }

/** Records every call instead of hitting a network; messageIds increment from 1. */
function fakeSender() {
  let nextMessageId = 1
  const sent: {
    chatId: number
    text: string
    replyMarkup?: InlineKeyboardLike
  }[] = []
  const edited: {
    chatId: number
    messageId: number
    text: string
    replyMarkup?: InlineKeyboardLike
  }[] = []
  const answered: { callbackQueryId: string; text?: string }[] = []
  const photos: {
    chatId: number
    photo: { path: string } | { url: string }
    caption?: string
  }[] = []
  const sender: TelegramSender = {
    async sendMessage(chatId, text, opts) {
      const messageId = nextMessageId++
      sent.push({ chatId, text, replyMarkup: opts?.replyMarkup })
      return { messageId }
    },
    async editMessageText(chatId, messageId, text, opts) {
      edited.push({ chatId, messageId, text, replyMarkup: opts?.replyMarkup })
    },
    async answerCallbackQuery(callbackQueryId, opts) {
      answered.push({ callbackQueryId, text: opts?.text })
    },
    async sendPhoto(chatId, photo, opts) {
      photos.push({ chatId, photo, caption: opts?.caption })
    }
  }
  return { sender, sent, edited, answered, photos }
}

/** One driver, one scripted fake LLM conversation, one allowlist. */
function makeDriver(
  script: FakeMessage[],
  sender: TelegramSender,
  allowedUserIds: number[],
  extraTools: Tool<never>[] = []
) {
  return createTelegramDriver({
    agentConfig: { model: "fake-model", tools: [askUserTool, runCommandTool] },
    personas: [persona],
    models: [],
    allowedUserIds,
    sender,
    createAgent: () => fakeAgent(script, extraTools)
  })
}

test("first message from an allowed user creates a session and finalizes the reply", async () => {
  const { sender, sent, edited } = fakeSender()
  const driver = makeDriver([{ content: "Hello there." }], sender, [42])

  await driver.handleMessage(42, 100, "hi")

  expect(sent).toHaveLength(1)
  expect(sent[0]!.text).toBe("…")
  expect(edited).toHaveLength(1)
  expect(edited[0]!.messageId).toBe(1)
  expect(edited[0]!.text).toBe("Hello there.")

  const saved = await loadLatestSessionRowForOwner(telegramOwner(42))
  expect(saved).toBeDefined()
  expect(saved!.owner).toBe(telegramOwner(42))
})

test("tool_image and display_image events are delivered as photos", async () => {
  const imagePath = join(tmpdir(), "kaja-test-telegram-photo.png")
  writeFileSync(imagePath, "not-a-real-png")
  const imageTool = tool<Record<string, never>>({
    name: "make_picture",
    description: "test tool that returns images",
    parameters: { type: "object", properties: {} },
    execute: async () => ({
      text: "made a picture",
      images: [{ path: imagePath, mimeType: "image/png" }],
      displayImage: { url: "https://example.com/pic.png", alt: "a preview" }
    })
  })
  const { sender, photos, edited } = fakeSender()
  const driver = makeDriver(
    [
      {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "make_picture", arguments: "{}" }
          }
        ]
      },
      { content: "Here is your picture." }
    ],
    sender,
    [42],
    [imageTool]
  )

  await driver.handleMessage(42, 100, "draw me something")

  expect(photos).toHaveLength(2)
  expect(photos[0]!.photo).toEqual({ url: "https://example.com/pic.png" })
  expect(photos[0]!.caption).toBe("a preview")
  expect(photos[1]!.photo).toEqual({ path: imagePath })
  expect(edited.at(-1)!.text).toBe("Here is your picture.")
})

test("a message from a disallowed user produces zero sender calls", async () => {
  const { sender, sent, edited, answered } = fakeSender()
  const driver = makeDriver([{ content: "should never run" }], sender, [42])

  await driver.handleMessage(999, 100, "hi")

  expect(sent).toHaveLength(0)
  expect(edited).toHaveLength(0)
  expect(answered).toHaveLength(0)
})

test("resuming continues a pre-seeded session, scoped to that owner only", async () => {
  await createSessionRow({
    persona: "kaja",
    model: "fake-model",
    owner: telegramOwner(42),
    session: {
      messages: [
        { role: "system", content: "be helpful" },
        { role: "user", content: "earlier message" },
        { role: "assistant", content: "earlier reply" }
      ]
    },
    events: [
      { type: "user", text: "earlier message" },
      { type: "final", content: "earlier reply" }
    ],
    title: "earlier message"
  })

  const { sender, edited } = fakeSender()
  const driver = makeDriver([{ content: "continued reply" }], sender, [42, 43])
  await driver.handleMessage(42, 100, "follow up")
  expect(edited.at(-1)!.text).toBe("continued reply")

  // A different user's first message must not see user 42's history — with
  // no pre-seeded row for user 43, this driver starts a fresh session for
  // them regardless.
  const { sender: sender43, edited: edited43 } = fakeSender()
  const driver43 = makeDriver([{ content: "fresh reply" }], sender43, [42, 43])
  await driver43.handleMessage(43, 200, "hello")
  expect(edited43.at(-1)!.text).toBe("fresh reply")
})

test("confirm_command sends an approval keyboard, and approving runs the command", async () => {
  const { sender, sent, edited } = fakeSender()
  const driver = makeDriver(
    [
      {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "run_command",
              arguments: JSON.stringify({
                command: "true",
                description: "Do nothing",
                mutates: true
              })
            }
          }
        ]
      },
      { content: "Done." }
    ],
    sender,
    [42]
  )

  await driver.handleMessage(42, 100, "please run true")

  const confirmMsg = sent.find((s) => s.replyMarkup)
  expect(confirmMsg).toBeDefined()
  expect(confirmMsg!.replyMarkup).toEqual([
    [
      {
        text: `✅ ${t("confirmCommand.yes")}`,
        callback_data: "cmd:approve:call_1"
      },
      {
        text: `❌ ${t("confirmCommand.no")}`,
        callback_data: "cmd:decline:call_1"
      }
    ]
  ])

  const confirmMessageId = sent.indexOf(confirmMsg!) + 1
  await driver.handleCallbackQuery(
    42,
    100,
    confirmMessageId,
    "cmd:approve:call_1",
    "cbq_1"
  )

  expect(edited.some((e) => e.text.includes(t("telegram.approved")))).toBe(true)
  expect(edited.at(-1)!.text).toBe("Done.")
})

test("declining a command feeds back a decline notice without a user-role event", async () => {
  const { sender, sent, edited } = fakeSender()
  const driver = makeDriver(
    [
      {
        content: null,
        tool_calls: [
          {
            id: "call_2",
            type: "function",
            function: {
              name: "run_command",
              arguments: JSON.stringify({
                command: "true",
                description: "Do nothing",
                mutates: true
              })
            }
          }
        ]
      },
      { content: "Understood." }
    ],
    sender,
    [42]
  )

  await driver.handleMessage(42, 100, "please run true")
  const confirmMsg = sent.find((s) => s.replyMarkup)!
  const confirmMessageId = sent.indexOf(confirmMsg) + 1
  await driver.handleCallbackQuery(
    42,
    100,
    confirmMessageId,
    "cmd:decline:call_2",
    "cbq_2"
  )

  expect(edited.some((e) => e.text.includes(t("telegram.declined")))).toBe(true)
  expect(edited.at(-1)!.text).toBe("Understood.")

  const saved = await loadLatestSessionRowForOwner(telegramOwner(42))
  expect(saved).toBeDefined()
  const userEvents = saved!.events.filter(
    (e: { type: string }) => e.type === "user"
  )
  expect(userEvents).toHaveLength(1)
  expect((userEvents[0] as unknown as { text: string }).text).toBe(
    "please run true"
  )
})

test("a callback with a stale/mismatched token doesn't touch state", async () => {
  const { sender, sent, edited } = fakeSender()
  const driver = makeDriver(
    [
      {
        content: null,
        tool_calls: [
          {
            id: "call_3",
            type: "function",
            function: {
              name: "run_command",
              arguments: JSON.stringify({
                command: "true",
                description: "Do nothing",
                mutates: true
              })
            }
          }
        ]
      }
    ],
    sender,
    [42]
  )

  await driver.handleMessage(42, 100, "please run true")
  const confirmMsg = sent.find((s) => s.replyMarkup)!
  const confirmMessageId = sent.indexOf(confirmMsg) + 1

  await driver.handleCallbackQuery(
    42,
    100,
    confirmMessageId,
    "cmd:approve:not-the-real-token",
    "cbq_stale"
  )

  expect(edited.at(-1)!.text).toBe(t("telegram.commandExpired"))
})

test("a message while busy or a command is pending gets a reminder instead of interleaving", async () => {
  const { sender, sent, edited } = fakeSender()
  const driver = makeDriver(
    [
      {
        content: null,
        tool_calls: [
          {
            id: "call_4",
            type: "function",
            function: {
              name: "run_command",
              arguments: JSON.stringify({
                command: "true",
                description: "Do nothing",
                mutates: true
              })
            }
          }
        ]
      }
    ],
    sender,
    [42]
  )

  await driver.handleMessage(42, 100, "please run true")
  const editsAfterFirstTurn = edited.length

  await driver.handleMessage(42, 100, "another message while pending")

  expect(sent.at(-1)!.text).toBe(t("telegram.pendingCommand"))
  expect(edited).toHaveLength(editsAfterFirstTurn)
})
