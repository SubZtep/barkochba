import { expect, mock, test } from "bun:test"

// telegram-bot.ts is the one grammy-aware module, so its own test mocks
// grammy's Bot rather than hitting the real Telegram API — mirrors how
// tests/lib/telegram-driver.test.ts stays grammy-free by testing against a
// fake TelegramSender instead.
const sendMessage = mock(async (_chatId: number, _text: string) => ({
  message_id: 1
}))
const getMe = mock(async () => ({ id: 1, is_bot: true, first_name: "bot" }))
let onStartHandler: (() => void) | undefined

mock.module("grammy", () => ({
  Bot: class {
    api = { getMe, sendMessage }
    on() {}
    catch() {}
    async start(opts?: { onStart?: () => void }) {
      onStartHandler = opts?.onStart
      onStartHandler?.()
    }
    async stop() {}
  },
  GrammyError: class extends Error {},
  InlineKeyboard: class {},
  InputFile: class {}
}))

const { createTelegramBot } = await import("../../lib/telegram-bot")
const { t } = await import("../../lib/i18n")

function makeBot(allowedUserIds: number[]) {
  return createTelegramBot({
    botToken: "token",
    allowedUserIds,
    agentConfig: { model: "m", tools: [] },
    personas: [],
    models: []
  })
}

test("start() notifies every allowed user that the bot is online", async () => {
  sendMessage.mockClear()
  const bot = makeBot([111, 222])
  await bot.start()
  expect(sendMessage).toHaveBeenCalledTimes(2)
  expect(sendMessage).toHaveBeenCalledWith(111, t("telegram.botOnline"))
  expect(sendMessage).toHaveBeenCalledWith(222, t("telegram.botOnline"))
})

test("stop() notifies every allowed user that the bot is going offline", async () => {
  sendMessage.mockClear()
  const bot = makeBot([333])
  await bot.stop()
  expect(sendMessage).toHaveBeenCalledTimes(1)
  expect(sendMessage).toHaveBeenCalledWith(333, t("telegram.botOffline"))
})

test("a rejected send for one user doesn't stop others from being notified", async () => {
  sendMessage.mockClear()
  sendMessage.mockImplementationOnce(async () => {
    throw new Error("blocked by user")
  })
  const bot = makeBot([444, 555])
  await bot.start()
  expect(sendMessage).toHaveBeenCalledTimes(2)
})
