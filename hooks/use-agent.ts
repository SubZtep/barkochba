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

  const send = useCallback(
    async (prompt: string) => {
      setPending(true)
      setEvents((prev) => [...prev, { type: "user", text: prompt }])
      try {
        for await (const event of run(agent, prompt, sessionRef.current!)) {
          if (event.type === "delta") {
            setPartial((prev) => {
              const next = prev ?? { reasoning: "", content: "" }
              return {
                ...next,
                [event.channel]: next[event.channel] + event.text
              }
            })
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

  return {
    agent,
    model,
    switchModel,
    persona,
    switchPersona,
    events,
    partial,
    pending,
    send
  }
}
