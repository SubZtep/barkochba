import type { TimelineEvent } from "../hooks/use-agent"
import type { ResolvedModel } from "../schemas/models"
import { telegramOwner } from "../schemas/session"
import { Agent, createSession, run, type Session } from "./agents"
import { isDangerousCommand } from "./command-risk"
import { categorizeError } from "./error-category"
import { t } from "./i18n"
import { log } from "./logger"
import { type Persona, samplingOf } from "./personas"
import { runShellCommand } from "./run-command"
import {
  createSessionRow,
  loadLatestSessionRowForOwner,
  updateSessionRow
} from "./session-store"
import {
  renderTelegramHtml,
  splitTelegramMessage,
  truncateForStreaming
} from "./telegram-markdown"

/** Command preview cap, matching components/layout/confirm-command.tsx's terminal UI. */
const MAX_COMMAND_LINES = 6

const MIN_EDIT_INTERVAL_MS = 1000
const MAX_EDIT_INTERVAL_MS = 4000

/** Thrown by a TelegramSender implementation on a 429 response, so EditThrottle can back off. */
export class TelegramRateLimitError extends Error {
  retryAfterSec: number | undefined

  constructor(retryAfterSec: number | undefined) {
    super("Telegram rate limit")
    this.retryAfterSec = retryAfterSec
  }
}

/** A minimal, structural inline-keyboard shape — not grammy's InlineKeyboard class — so this module has no grammy dependency. */
export type InlineKeyboardLike = { text: string; callback_data: string }[][]

/**
 * Abstraction over the actual Telegram API calls, so the driver is testable
 * without a live bot and has zero import of grammy itself. lib/telegram-bot.ts
 * implements this against the real bot.api, translating grammy's own errors
 * (429s, "message is not modified") at that boundary.
 */
export type TelegramSender = {
  sendMessage(
    chatId: number,
    text: string,
    opts?: { replyMarkup?: InlineKeyboardLike }
  ): Promise<{ messageId: number }>
  editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    opts?: { replyMarkup?: InlineKeyboardLike }
  ): Promise<void>
  answerCallbackQuery(
    callbackQueryId: string,
    opts?: { text?: string }
  ): Promise<void>
}

export type TelegramDriverConfig = {
  /** Model/tools/instructions baseline every user's Agent is constructed with. */
  agentConfig: ConstructorParameters<typeof Agent>[0]
  personas: Persona[]
  models: ResolvedModel[]
  /** Fallback persona for a user with no resumable session; defaults to personas[0]. */
  initialPersona?: Persona
  allowedUserIds: number[]
  sender: TelegramSender
  /**
   * Constructs the Agent for a newly-created UserState. Defaults to `new
   * Agent(...)`; overridable so tests can substitute a fake OpenAI-shaped
   * client the same way tests/lib/agents.test.ts does, without going through
   * the real lib/openai.ts singleton Agent's constructor always pulls in.
   */
  createAgent?: (init: {
    instructions?: string
    sampling?: ReturnType<typeof samplingOf>
  }) => Agent
}

type PendingCommand = {
  command: string
  /** The message text sent for the approval prompt, so resolving it can append a status line in place. */
  body: string
  messageId: number
}

type UserState = {
  agent: Agent
  session: Session
  events: TimelineEvent[]
  sessionRowId: number | undefined
  persona: Persona
  /** Serializes saves the same way hooks/use-agent.ts's persistChainRef does, so a fast next turn can't race the row-id assignment into a duplicate INSERT. */
  persistChain: Promise<void>
  pendingCommand: PendingCommand | undefined
  busy: boolean
}

/**
 * Coalesces rapid delta events into at most one Telegram edit per
 * `intervalMs`, using only the latest accumulated text (never queuing
 * multiple edits). Mirrors the trailing-edge throttle hooks/use-agent.ts
 * already uses for its DELTA_INTERVAL_MS flush, tuned for Telegram's ~1
 * edit/sec per-message budget instead of Ink's repaint rate, with 429
 * backoff added since Telegram (unlike a local terminal) can reject bursts.
 */
class EditThrottle {
  private intervalMs = MIN_EDIT_INTERVAL_MS
  private lastEditAt = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private pendingRender: (() => string) | undefined
  // sendEdit is expected to dedupe identical text itself (see runTurn's
  // shared editIfChanged) — the throttle only decides *when* to call it.
  private readonly sendEdit: (text: string) => Promise<void>

  constructor(sendEdit: (text: string) => Promise<void>) {
    this.sendEdit = sendEdit
  }

  request(renderText: () => string) {
    this.pendingRender = renderText
    if (this.timer) return
    // Always goes through setTimeout, even at 0ms delay once intervalMs has
    // elapsed — never fires synchronously inline. That guarantees cancel()
    // (called from the same microtask chain that follows a delta, e.g. once
    // run() reaches its final/ask_user/confirm_command event) can always
    // pre-empt a still-pending fire, since a macrotask timer only runs after
    // the current microtask queue has fully drained.
    const elapsed = Date.now() - this.lastEditAt
    const delay = Math.max(0, this.intervalMs - elapsed)
    this.timer = setTimeout(() => void this.fire(), delay)
  }

  private async fire() {
    this.timer = undefined
    const render = this.pendingRender
    this.pendingRender = undefined
    if (!render) return
    this.lastEditAt = Date.now()
    try {
      await this.sendEdit(render())
    } catch (error) {
      if (error instanceof TelegramRateLimitError) {
        this.intervalMs = Math.min(this.intervalMs * 2, MAX_EDIT_INTERVAL_MS)
        if (error.retryAfterSec)
          this.lastEditAt = Date.now() + error.retryAfterSec * 1000
      } else {
        log.warn({ error }, "Telegram edit failed")
      }
    }
  }

  /**
   * Cancels any pending trailing-edge edit without sending it — call before
   * a caller-driven edit that's about to supersede it anyway (final,
   * ask_user, confirm_command), so the throttle doesn't fire a redundant
   * edit moments after (or race with) that one.
   */
  cancel() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this.pendingRender = undefined
  }
}

export function createTelegramDriver(config: TelegramDriverConfig) {
  const { agentConfig, personas, models, initialPersona, sender } = config
  const createAgent =
    config.createAgent ??
    ((init: {
      instructions?: string
      sampling?: ReturnType<typeof samplingOf>
    }) => new Agent({ ...agentConfig, ...init }))
  const allowedUserIds = new Set(config.allowedUserIds)
  const users = new Map<number, UserState>()
  const creating = new Map<number, Promise<UserState>>()

  async function createUserState(userId: number): Promise<UserState> {
    const owner = telegramOwner(userId)
    const resumeRow = await loadLatestSessionRowForOwner(owner)
    const persona =
      (resumeRow && personas.find((p) => p.id === resumeRow.persona)) ??
      initialPersona ??
      personas[0]!
    const resumeModel =
      resumeRow && models.find((m) => m.id === resumeRow.model)

    const agent = createAgent({
      instructions: persona.instructions ?? agentConfig.instructions,
      sampling: samplingOf(persona)
    })
    const startingModel =
      resumeModel ??
      (!resumeRow && persona.model
        ? models.find((m) => m.id === persona.model)
        : undefined)
    if (startingModel) agent.setModel(startingModel)

    return {
      agent,
      session: resumeRow ? (resumeRow.session as Session) : createSession(),
      events: (resumeRow?.events as TimelineEvent[] | undefined) ?? [],
      sessionRowId: resumeRow?.id,
      persona,
      persistChain: Promise.resolve(),
      pendingCommand: undefined,
      busy: false
    }
  }

  async function getUserState(userId: number): Promise<UserState> {
    const existing = users.get(userId)
    if (existing) return existing
    const inFlight = creating.get(userId)
    if (inFlight) return inFlight
    const promise = createUserState(userId).then((state) => {
      users.set(userId, state)
      creating.delete(userId)
      return state
    })
    creating.set(userId, promise)
    return promise
  }

  // Unlike hooks/use-agent.ts's fire-and-forget persistSession (which must
  // not block a React state update on a DB write), this one is awaited by
  // runTurn before the turn is considered done — there's no UI to unblock
  // here, and it's a fast local SQLite write, so waiting for it makes
  // "the turn finished" mean the same thing for both Telegram and the DB.
  function persistSession(userId: number, state: UserState): Promise<void> {
    const first = state.events.find(
      (e): e is Extract<TimelineEvent, { type: "user" }> => e.type === "user"
    )
    if (!first) return Promise.resolve()
    const data = {
      persona: state.persona.id,
      model: state.agent.model,
      owner: telegramOwner(userId),
      session: state.session,
      events: state.events
    }
    state.persistChain = state.persistChain
      .then(async () => {
        if (state.sessionRowId === undefined) {
          state.sessionRowId = await createSessionRow({
            ...data,
            title: first.text.split(/[\r\n]/)[0]!.slice(0, 60)
          })
        } else {
          await updateSessionRow(state.sessionRowId, data)
        }
      })
      .catch((error) => log.warn({ error }, "Failed to save telegram session"))
    return state.persistChain
  }

  async function editSafely(
    chatId: number,
    messageId: number,
    text: string,
    opts?: { replyMarkup?: InlineKeyboardLike }
  ) {
    try {
      await sender.editMessageText(chatId, messageId, text, opts)
    } catch (error) {
      log.warn({ error }, "Telegram edit failed")
    }
  }

  /**
   * Renders and sends the authoritative final text for a turn, via
   * `edit` (the same dedupe-guarded editor the turn's EditThrottle uses —
   * see runTurn) so this never re-sends an identical edit the throttle
   * already delivered. Chunks past the first (only once the rendered HTML
   * exceeds Telegram's message limit) go out as new messages, since editing
   * only ever targets the one existing placeholder.
   */
  async function finalizeMessage(
    edit: (text: string) => Promise<void>,
    chatId: number,
    rawText: string
  ) {
    const html = renderTelegramHtml(rawText) || t("telegram.emptyResponse")
    const [first, ...rest] = splitTelegramMessage(html)
    await edit(first!)
    for (const chunk of rest) await sender.sendMessage(chatId, chunk)
  }

  async function sendConfirmCommand(
    chatId: number,
    state: UserState,
    event: { command: string; description: string }
  ) {
    const dangerous = isDangerousCommand(event.command)
    const lines = event.command.split("\n")
    const preview = lines.slice(0, MAX_COMMAND_LINES).join("\n")
    const hidden = lines.length - MAX_COMMAND_LINES
    const description = dangerous ? `⚠ ${event.description}` : event.description
    const body = [
      renderTelegramHtml(description),
      `<pre><code>$ ${renderTelegramHtml(preview)}</code></pre>`,
      hidden > 0 ? t("confirmCommand.truncated", { count: hidden }) : undefined
    ]
      .filter(Boolean)
      .join("\n")

    // The tool_call id the model provider already minted for this call,
    // already stored on session.pendingRunCommandId — reused as the
    // callback_data correlator instead of generating a separate token, and
    // short enough to fit the Bot API's 64-byte callback_data cap (unlike
    // the command text itself).
    const token = state.session.pendingRunCommandId!
    const keyboard: InlineKeyboardLike = [
      [
        {
          text: `✅ ${t("confirmCommand.yes")}`,
          callback_data: `cmd:approve:${token}`
        },
        {
          text: `❌ ${t("confirmCommand.no")}`,
          callback_data: `cmd:decline:${token}`
        }
      ]
    ]
    const sent = await sender.sendMessage(chatId, body, {
      replyMarkup: keyboard
    })
    state.pendingCommand = {
      command: event.command,
      body,
      messageId: sent.messageId
    }
  }

  async function runTurn(
    userId: number,
    chatId: number,
    state: UserState,
    prompt: string,
    showUserEvent: boolean
  ) {
    state.busy = true
    if (showUserEvent) state.events.push({ type: "user", text: prompt })

    const placeholder = await sender.sendMessage(chatId, "…")
    const accumulated = { content: "" }
    const renderCurrent = () =>
      accumulated.content.trim()
        ? truncateForStreaming(renderTelegramHtml(accumulated.content))
        : "…"
    // Shared between the throttle and every direct edit below, so a
    // caller-driven edit (finalize/error) that happens to match whatever
    // the throttle already sent never re-sends the same text.
    let lastSentText: string | undefined
    async function editIfChanged(text: string) {
      if (text === lastSentText) return
      lastSentText = text
      await editSafely(chatId, placeholder.messageId, text)
    }
    const throttle = new EditThrottle(editIfChanged)

    try {
      for await (const event of run(state.agent, prompt, state.session)) {
        if (event.type === "delta") {
          // Reasoning deltas are omitted from the live bubble — mirrors the
          // terminal's optional/collapsed reasoning display.
          if (event.channel === "content") {
            accumulated.content += event.text
            throttle.request(renderCurrent)
          }
          continue
        }

        state.events.push(event)

        if (event.type === "confirm_command") {
          throttle.cancel()
          if (accumulated.content.trim())
            await finalizeMessage(editIfChanged, chatId, accumulated.content)
          await sendConfirmCommand(chatId, state, event)
          return
        }

        if (event.type === "ask_user") {
          throttle.cancel()
          const text = accumulated.content.trim()
            ? `${accumulated.content}\n\n${event.question}`
            : event.question
          await finalizeMessage(editIfChanged, chatId, text)
          return
        }

        if (event.type === "final") {
          throttle.cancel()
          await finalizeMessage(editIfChanged, chatId, event.content ?? "")
          return
        }
      }
    } catch (error) {
      log.warn({ error }, "Telegram agent run failed")
      const { category, message } = categorizeError(error)
      state.events.push({ type: "error", text: message, category })
      await editIfChanged(`⚠ ${category}: ${message}`)
    } finally {
      state.busy = false
      await persistSession(userId, state)
    }
  }

  async function handleMessage(userId: number, chatId: number, text: string) {
    if (!allowedUserIds.has(userId)) return
    const state = await getUserState(userId)

    if (state.busy) {
      await sender.sendMessage(chatId, t("telegram.stillWorking"))
      return
    }
    if (state.pendingCommand) {
      await sender.sendMessage(chatId, t("telegram.pendingCommand"))
      return
    }

    await runTurn(userId, chatId, state, text, true)
  }

  async function handleCallbackQuery(
    userId: number,
    chatId: number,
    messageId: number,
    data: string,
    callbackQueryId: string
  ) {
    // Ack immediately regardless of outcome — Telegram shows a client-side
    // spinner on the pressed button until this call resolves.
    await sender.answerCallbackQuery(callbackQueryId)
    if (!allowedUserIds.has(userId)) return

    const match = /^cmd:(approve|decline):(.+)$/.exec(data)
    if (!match) return
    const action = match[1] as "approve" | "decline"
    const token = match[2]!

    const state = await getUserState(userId)
    // The pressing user's id comes from the callback source (grammy:
    // ctx.from.id), never from the payload, so this can only ever check
    // against *that same user's* pendingCommand — even a leaked/guessed
    // callback_data from another user's session can't cross over.
    if (!state.pendingCommand || state.session.pendingRunCommandId !== token) {
      await editSafely(chatId, messageId, t("telegram.commandExpired"), {
        replyMarkup: []
      })
      return
    }

    const { command, body, messageId: pendingMessageId } = state.pendingCommand
    state.pendingCommand = undefined
    const approved = action === "approve"
    await editSafely(
      chatId,
      pendingMessageId,
      `${body}\n\n${approved ? `✅ ${t("telegram.approved")}` : `❌ ${t("telegram.declined")}`}`,
      { replyMarkup: [] }
    )

    const result = approved
      ? await runShellCommand(command)
      : "User declined to run this command."
    // showUserEvent = false: the synthesized shell result isn't something
    // the human typed, so it drives the next turn without rendering as if
    // they said it — matches hooks/use-agent.ts's resolveCommand.
    await runTurn(userId, chatId, state, result, false)
  }

  return { handleMessage, handleCallbackQuery }
}
