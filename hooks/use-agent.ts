import { useCallback, useRef, useState } from "react"
import {
  Agent,
  createSession,
  type FinalizedAgentEvent,
  run,
  type Session
} from "../lib/agents"

/**
 * What the chat timeline is made of: the human's own messages plus the
 * agent's finalized events.
 */
export type TimelineEvent = { type: "user"; text: string } | FinalizedAgentEvent

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

  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [partial, setPartial] = useState<PartialMessage | null>(null)
  const [pending, setPending] = useState(false)

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
      } finally {
        setPartial(null)
        setPending(false)
      }
    },
    [agent]
  )

  return { agent, events, partial, pending, send }
}
