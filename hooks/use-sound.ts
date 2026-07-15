import { useEffect, useRef } from "react"
import { playSound } from "../lib/my-computer"
import type { TimelineEvent } from "./use-agent"

const eventSound = {
  reasoning: "wind",
  tool_call: "magic",
  ask_user: "bell",
  final: "hehe"
} as const

/**
 * Plays the matching sound for each newly arrived {@link TimelineEvent},
 * mirroring the CLI loop in agent.ts. The human's own messages are silent.
 */
export function useSound(events: TimelineEvent[]) {
  const played = useRef(0)
  useEffect(() => {
    for (const event of events.slice(played.current)) {
      if (event.type !== "user") playSound(eventSound[event.type])
    }
    played.current = events.length
  }, [events])
}
