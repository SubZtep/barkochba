import { useCallback, useRef, useState } from "react"
import {
  Agent,
  createSession,
  type FinalizedAgentEvent,
  run,
  type Session
} from "../lib/agents"
import { log } from "../lib/logger"
import { type Persona, personas } from "../lib/personas"
import { runShellCommand } from "../lib/run-command"
import type { ResolvedModel } from "../schemas/models"

/**
 * What the chat timeline is made of: the human's own messages, the agent's
 * finalized events, and errors from failed runs (e.g. a model that isn't
 * deployed) — surfaced in the timeline instead of crashing the app.
 */
export type TimelineEvent =
  | { type: "user"; text: string }
  | { type: "error"; text: string }
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

/**
 * Drives an {@link Agent} from React state: constructs the agent and its
 * {@link Session} once, and exposes a `send` function that runs a prompt to
 * completion, collecting the yielded events as they arrive. `events` is the
 * finalized timeline (including the user's own messages); `partial` holds
 * the in-flight streaming message, if any.
 */
export function useAgent(config: ConstructorParameters<typeof Agent>[0]) {
  const [agent] = useState(() => new Agent(config))
  const sessionRef = useRef<Session>(undefined)
  if (!sessionRef.current) sessionRef.current = createSession()

  // React-state mirror of agent.model, so consumers rerender on switch.
  const [model, setModel] = useState(agent.model)
  const switchModel = useCallback(
    (next: ResolvedModel) => {
      agent.setModel(next)
      setModel(next.id)
    },
    [agent]
  )

  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [partial, setPartial] = useState<PartialMessage | null>(null)
  const [pending, setPending] = useState(false)
  // True from the moment a run_command is approved until its result is fed
  // back — separate from `pending` (which only covers the run() loop itself)
  // so the confirm UI can hide/disable while the shell command is in flight.
  const [runningCommand, setRunningCommand] = useState(false)

  // Adopting a persona swaps the agent's instructions and starts a fresh
  // session/timeline — run() bakes instructions into the first system
  // message, so they can't change mid-conversation.
  const [persona, setPersona] = useState<Persona>(personas[0]!)
  const switchPersona = useCallback(
    (next: Persona) => {
      if (pending) return
      agent.instructions = next.instructions
      sessionRef.current = createSession()
      setEvents([])
      setPartial(null)
      setPersona(next)
    },
    [agent, pending]
  )

  // showUserEvent is false when the "prompt" isn't something the human
  // typed (e.g. resolveCommand feeding back a shell command's result) — it
  // still drives run() as the next turn, but shouldn't render as if the
  // human said it.
  const send = useCallback(
    async (prompt: string, showUserEvent = true) => {
      setPending(true)
      if (showUserEvent)
        setEvents((prev) => [...prev, { type: "user", text: prompt }])
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
            setEvents((prev) => [...prev, event])
          }
        }
      } catch (error: any) {
        log.warn({ error }, "Agent run failed")
        setEvents((prev) => [
          ...prev,
          { type: "error", text: error?.message ?? String(error) }
        ])
      } finally {
        setPartial(null)
        setPending(false)
      }
    },
    [agent]
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
    send,
    resolveCommand,
    runningCommand
  }
}
