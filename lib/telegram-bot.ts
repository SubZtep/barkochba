import { Bot, GrammyError, InlineKeyboard, InputFile } from "grammy"
import type { KajaTelegram } from "../schemas/config"
import type { ResolvedModel } from "../schemas/models"
import type { Agent } from "./agents"
import { t } from "./i18n"
import { log } from "./logger"
import type { Persona } from "./personas"
import {
  createTelegramDriver,
  type InlineKeyboardLike,
  TelegramRateLimitError
} from "./telegram-driver"

export type CreateTelegramBotConfig = KajaTelegram & {
  agentConfig: ConstructorParameters<typeof Agent>[0]
  personas: Persona[]
  models: ResolvedModel[]
  getInitialPersona?: () => Persona | undefined
}

function buildKeyboard(keyboard: InlineKeyboardLike | undefined) {
  return keyboard ? new InlineKeyboard(keyboard) : undefined
}

/** Telegram's "message is not modified" 400 is an expected race (see EditThrottle's own client-side guard), not an error. */
function isNotModifiedError(error: unknown): boolean {
  return (
    error instanceof GrammyError &&
    error.error_code === 400 &&
    error.description.includes("message is not modified")
  )
}

/** Translates a 429 into the typed error telegram-driver.ts's EditThrottle knows how to back off on. */
function asRateLimitError(error: unknown): TelegramRateLimitError | undefined {
  if (error instanceof GrammyError && error.error_code === 429)
    return new TelegramRateLimitError(error.parameters.retry_after)
  return undefined
}

/**
 * Runs `send` once, and on a single 429 sleeps for its retry_after and tries
 * exactly once more — shared by every one-shot sendMessage call site (there's
 * no throttle to defer to for those, unlike editMessageText's stream of
 * edits, which instead lets TelegramRateLimitError propagate to the
 * driver's own EditThrottle backoff). A second failure (or a 429 with no
 * retry_after) always propagates.
 */
async function withRateLimitRetry<T>(send: () => Promise<T>): Promise<T> {
  try {
    return await send()
  } catch (error) {
    const rateLimit = asRateLimitError(error)
    if (!rateLimit?.retryAfterSec) throw error
    await Bun.sleep(rateLimit.retryAfterSec * 1000)
    return send()
  }
}

/**
 * The only grammy-aware file: constructs the Bot, implements
 * lib/telegram-driver.ts's TelegramSender against bot.api, wires update
 * handlers to the driver, and owns startup validation (getMe preflight) and
 * shutdown (bot.stop()). lib/telegram-driver.ts itself never imports grammy.
 */
export function createTelegramBot(config: CreateTelegramBotConfig) {
  const bot = new Bot(config.botToken)

  const driver = createTelegramDriver({
    agentConfig: config.agentConfig,
    personas: config.personas,
    models: config.models,
    getInitialPersona: config.getInitialPersona,
    allowedUserIds: config.allowedUserIds,
    sender: {
      async sendMessage(chatId, text, opts) {
        const message = await withRateLimitRetry(() =>
          bot.api.sendMessage(chatId, text, {
            parse_mode: "HTML",
            reply_markup: buildKeyboard(opts?.replyMarkup)
          })
        )
        return { messageId: message.message_id }
      },
      async editMessageText(chatId, messageId, text, opts) {
        try {
          await bot.api.editMessageText(chatId, messageId, text, {
            parse_mode: "HTML",
            reply_markup: buildKeyboard(opts?.replyMarkup)
          })
        } catch (error) {
          if (isNotModifiedError(error)) return
          const rateLimit = asRateLimitError(error)
          if (rateLimit) throw rateLimit
          throw error
        }
      },
      async answerCallbackQuery(callbackQueryId, opts) {
        await bot.api.answerCallbackQuery(callbackQueryId, { text: opts?.text })
      },
      async sendPhoto(chatId, photo, opts) {
        await withRateLimitRetry(() =>
          bot.api.sendPhoto(
            chatId,
            "path" in photo ? new InputFile(photo.path) : photo.url,
            opts?.caption ? { caption: opts.caption } : undefined
          )
        )
      }
    }
  })

  bot.on("message:text", (ctx) => {
    void driver.handleMessage(ctx.from.id, ctx.chat.id, ctx.message.text)
  })

  bot.on("callback_query:data", (ctx) => {
    const chatId = ctx.callbackQuery.message?.chat.id
    const messageId = ctx.callbackQuery.message?.message_id
    if (chatId === undefined || messageId === undefined) return
    void driver.handleCallbackQuery(
      ctx.from.id,
      chatId,
      messageId,
      ctx.callbackQuery.data,
      ctx.callbackQuery.id
    )
  })

  bot.catch((err) => {
    // A 401 here (unlike at the getMe() preflight in start()) means the
    // token was revoked mid-session — every future API call will fail the
    // same way, including the notify-the-user sendMessage below, so that
    // failure would otherwise go completely silent. Log it distinctly so an
    // operator watching logs can tell "bot is dead" apart from one bad
    // update.
    if (err.error instanceof GrammyError && err.error.error_code === 401) {
      log.error(
        { error: err.error },
        "Telegram bot token rejected — bot is now unreachable"
      )
      return
    }
    log.error(
      { error: err.error },
      "Unhandled error in Telegram update handler"
    )
    const chatId = err.ctx.chat?.id
    if (chatId !== undefined)
      bot.api.sendMessage(chatId, t("telegram.genericError")).catch(() => {})
  })

  /** Broadcasts a lifecycle notice to every allowed user's DM (chat.id === user id there); one blocked/invalid user can't stop the others from being notified. */
  async function notifyAll(text: string) {
    await Promise.allSettled(
      config.allowedUserIds.map((userId) => bot.api.sendMessage(userId, text))
    )
  }

  return {
    async start() {
      try {
        await bot.api.getMe()
      } catch (error) {
        throw new Error(t("telegram.invalidToken"), { cause: error })
      }
      await bot.start({
        onStart: () => {
          console.log(t("telegram.ready"))
          void notifyAll(t("telegram.botOnline"))
        }
      })
    },
    async stop() {
      await notifyAll(t("telegram.botOffline"))
      await bot.stop()
    }
  }
}
