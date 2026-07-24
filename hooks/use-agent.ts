import { useCallback, useRef, useState } from "react"
import {
  Agent,
  createSession,
  type FinalizedAgentEvent,
  run,
  type Session
} from "../lib/agents"
import { categorizeError, type ErrorCategory } from "../lib/error-category"
import { log } from "../lib/logger"
import type { Persona } from "../lib/personas"
import { runShellCommand } from "../lib/run-command"
import { createSessionRow, updateSessionRow } from "../lib/session-store"
import type { ResolvedModel } from "../schemas/models"
import type { SamplingParams } from "../schemas/personas"
import type { PersistedSession } from "../schemas/session"

/**
 * What the chat timeline is made of: the human's own messages, the agent's
 * finalized events, and errors from failed runs (e.g. a model that isn't
 * deployed) — surfaced in the timeline instead of crashing the app.
 */
export type TimelineEvent =
  | { type: "user"; text: string }
  | { type: "error"; text: string; category: ErrorCategory }
  | FinalizedAgentEvent

/**
 * The message currently streaming in, accumulated from delta events. Cleared
 * whenever a finalized event replaces it in the timeline.
 */
export type PartialMessage = { reasoning: string; content: string }

/**
 * Minimum time between partial-message re-renders while streaming. Deltas
 * can arrive far faster than this; capping the render rate keeps Ink's
 * frame repaints (and terminals that struggle with tall, fast-changing
 * content) from falling behind on long responses.
 */
const DELTA_INTERVAL_MS = 80

/** Pulls a persona's optional sampling overrides into an Agent-shaped object. */
function samplingOf(persona?: Persona): SamplingParams | undefined {
  if (!persona) return undefined
  const {
    temperature,
    top_p,
    max_tokens,
    frequency_penalty,
    presence_penalty,
    seed
  } = persona
  const sampling = {
    temperature,
    top_p,
    max_tokens,
    frequency_penalty,
    presence_penalty,
    seed
  }
  return Object.values(sampling).some((v) => v !== undefined)
    ? sampling
    : undefined
}

/**
 * Drives an {@link Agent} from React state: constructs the agent and its
 * {@link Session} once, and exposes a `send` function that runs a prompt to
 * completion, collecting the yielded events as they arrive. `events` is the
 * finalized timeline (including the user's own messages); `partial` holds
 * the in-flight streaming message, if any.
 *
 * With `resume`, both are seeded from a persisted session instead of empty:
 * the restored messages already contain their system prompt (run() only
 * builds one for an empty session), so the original persona instructions
 * and sticky notes stay baked in — by design. After every completed turn
 * the session is saved back to the store, fire-and-forget.
 */
export function useAgent(
  config: ConstructorParameters<typeof Agent>[0] & {
    personas: Persona[]
    /** Models available to resolve a persona's optional `model` field against. */
    models: ResolvedModel[]
    /** Fallback persona when not resuming a session; defaults to personas[0]. */
    initialPersona?: Persona
    resume?: {
      session: PersistedSession
      persona?: Persona
      model?: ResolvedModel
    }
  }
) {
  const { resume, personas, initialPersona, models, ...agentConfig } = config
  const [agent] = useState(() => {
    const startingPersona = resume?.persona ?? initialPersona
    const created = new Agent({
      ...agentConfig,
      instructions: startingPersona?.instructions ?? agentConfig.instructions,
      sampling: samplingOf(startingPersona)
    })
    const startingModel =
      resume?.model ??
      (!resume && startingPersona?.model
        ? models.find((m) => m.id === startingPersona.model)
        : undefined)
    if (startingModel) created.setModel(startingModel)
    return created
  })
  const sessionRef = useRef<Session>(undefined)
  if (!sessionRef.current)
    sessionRef.current = resume
      ? (resume.session.session as Session)
      : createSession()
  // The database row this conversation saves into; undefined until the
  // first save (empty sessions are never recorded).
  const sessionRowIdRef = useRef<number | undefined>(resume?.session.id)

  // React-state mirror of agent.model, so consumers rerender on switch.
  const [model, setModel] = useState(agent.model)
  const switchModel = useCallback(
    (next: ResolvedModel) => {
      agent.setModel(next)
      setModel(next.id)
    },
    [agent]
  )

  const [events, setEvents] = useState<TimelineEvent[]>(
    () => (resume?.session.events as TimelineEvent[] | undefined) ?? []
  )
  // Ref mirror of `events` for send/persistSession, whose closures are
  // memoized on [agent] and would otherwise read a stale array.
  const eventsRef = useRef(events)
  const pushEvent = useCallback((event: TimelineEvent) => {
    eventsRef.current = [...eventsRef.current, event]
    setEvents(eventsRef.current)
  }, [])
  const [partial, setPartial] = useState<PartialMessage | null>(null)
  const [pending, setPending] = useState(false)
  // The in-flight tool call, if the most recent event is one and a run is
  // still pending — there's no separate "tool finished" event, so this is
  // derived rather than tracked: any later event naturally supersedes it.
  const lastEvent = events.at(-1)
  const currentTool =
    pending && lastEvent?.type === "tool_call" ? lastEvent : undefined
  // True from the moment a run_command is approved until its result is fed
  // back — separate from `pending` (which only covers the run() loop itself)
  // so the confirm UI can hide/disable while the shell command is in flight.
  const [runningCommand, setRunningCommand] = useState(false)

  // Adopting a persona swaps the agent's instructions and starts a fresh
  // session/timeline — run() bakes instructions into the first system
  // message, so they can't change mid-conversation.
  const [persona, setPersona] = useState<Persona>(
    resume?.persona ?? initialPersona ?? personas[0]!
  )
  const personaRef = useRef(persona)
  const switchPersona = useCallback(
    (next: Persona) => {
      if (pending) return
      agent.instructions = next.instructions
      agent.sampling = samplingOf(next)
      // Only sets the starting point for the new session — the user can
      // still switch models manually afterward via switchModel.
      const nextModel = next.model
        ? models.find((m) => m.id === next.model)
        : undefined
      if (nextModel) {
        agent.setModel(nextModel)
        setModel(nextModel.id)
      }
      sessionRef.current = createSession()
      sessionRowIdRef.current = undefined
      eventsRef.current = []
      setEvents([])
      setPartial(null)
      personaRef.current = next
      setPersona(next)
    },
    [agent, pending, models]
  )

  // Saves the conversation after each turn, fire-and-forget like
  // saveSettings — but serialized through a promise chain so a fast next
  // turn can't race the row-id assignment into a duplicate INSERT.
  const persistChainRef = useRef(Promise.resolve())
  const persistSession = useCallback(() => {
    const session = sessionRef.current!
    const events = eventsRef.current
    const first = events.find(
      (e): e is Extract<TimelineEvent, { type: "user" }> => e.type === "user"
    )
    if (!first) return
    const data = {
      persona: personaRef.current.id,
      model: agent.model,
      session,
      events
    }
    persistChainRef.current = persistChainRef.current
      .then(async () => {
        if (sessionRowIdRef.current === undefined) {
          sessionRowIdRef.current = await createSessionRow({
            ...data,
            title: first.text.split(/[\r\n]/)[0]!.slice(0, 60)
          })
        } else {
          await updateSessionRow(sessionRowIdRef.current, data)
        }
      })
      .catch((error) => log.warn({ error }, "Failed to save session"))
  }, [agent])

  // showUserEvent is false when the "prompt" isn't something the human
  // typed (e.g. resolveCommand feeding back a shell command's result) — it
  // still drives run() as the next turn, but shouldn't render as if the
  // human said it.
  const send = useCallback(
    async (prompt: string, showUserEvent = true) => {
      setPending(true)
      if (showUserEvent) pushEvent({ type: "user", text: prompt })
      // Deltas can arrive many times a second; re-rendering (and Ink
      // repainting the whole frame) on every single token makes long
      // streamed responses janky — some terminals (e.g. VS Code's) visibly
      // struggle to keep up once the content is taller than the viewport.
      // Accumulate here and only push to state at most every DELTA_INTERVAL_MS.
      const accumulated: PartialMessage = { reasoning: "", content: "" }
      let hasPartial = false
      let lastFlush = 0
      const flush = () => {
        if (hasPartial) setPartial({ ...accumulated })
      }
      try {
        for await (const event of run(agent, prompt, sessionRef.current!)) {
          if (event.type === "delta") {
            accumulated[event.channel] += event.text
            hasPartial = true
            const now = Date.now()
            if (now - lastFlush >= DELTA_INTERVAL_MS) {
              lastFlush = now
              flush()
            }
          } else {
            setPartial(null)
            pushEvent(event)
          }
        }
      } catch (error) {
        log.warn({ error }, "Agent run failed")
        const { category, message } = categorizeError(error)
        pushEvent({ type: "error", text: message, category })
      } finally {
        setPartial(null)
        setPending(false)
        persistSession()
      }
    },
    [agent, pushEvent, persistSession]
  )

  // Resolves a pending confirm_command event: runs the command on approval
  // (or a decline notice otherwise) and feeds the result back to run() as
  // the next prompt — session.pendingRunCommandId routes it as the matching
  // tool response regardless of the prompt's content.
  const resolveCommand = useCallback(
    async (command: string, approved: boolean) => {
      if (runningCommand) return
      setRunningCommand(true)
      try {
        const result = approved
          ? await runShellCommand(command)
          : "User declined to run this command."
        await send(result, false)
      } finally {
        setRunningCommand(false)
      }
    },
    [send, runningCommand]
  )

  return {
    agent,
    model,
    switchModel,
    persona,
    switchPersona,
    events,
    partial,
    pending,
    currentTool,
    send,
    resolveCommand,
    runningCommand
  }
}
