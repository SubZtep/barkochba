import { useEffect, useRef } from "react"
import { createLocalSink } from "../lib/frontends/local"
import { log } from "../lib/logger"
import { toSpeakable } from "../lib/speakable"
import { createTts, warmupTts } from "../lib/tts"
import type { TimelineEvent } from "./use-agent"

/** The text an event "says" out loud, or null for silent event types. */
function speakableText(event: TimelineEvent): string | null {
  switch (event.type) {
    case "message":
      return event.content
    case "final":
      return event.content
    case "ask_user":
      return event.question
    default:
      return null
  }
}

/**
 * Speaks each newly arrived assistant reply ({@link speakableText}) through
 * the local speakers via the speaches TTS server. The sink and TTS client are
 * created lazily on the first spoken event, so nothing is spawned while the
 * setting is off. Utterances queue in arrival order (see createTts); a failed
 * synthesis (e.g. server down) is logged, never thrown. Events arriving while
 * disabled are marked as spoken, so enabling doesn't replay the backlog.
 */
export function useVoice(events: TimelineEvent[], enabled = false) {
  const spoken = useRef(0)
  const tts = useRef<{ speak: (text: string) => Promise<void> }>(undefined)
  const sink = useRef<ReturnType<typeof createLocalSink>>(undefined)

  // Load the TTS model server-side when voice turns on, so the first real
  // reply doesn't pay the model-load delay. warmupTts logs its own failures.
  useEffect(() => {
    if (enabled) void warmupTts()
  }, [enabled])

  useEffect(() => {
    const pending = events.slice(spoken.current)
    spoken.current = events.length
    if (!enabled) return
    for (const event of pending) {
      const text = speakableText(event)
      if (!text) continue
      const speech = toSpeakable(text)
      if (!speech) continue
      if (!tts.current) {
        sink.current = createLocalSink()
        tts.current = createTts(sink.current)
      }
      tts.current.speak(speech).catch((error) => {
        log.warn({ error }, "voice: speak failed")
      })
    }
  }, [events, enabled])

  // Kill the ffplay child on unmount instead of leaving it to linger.
  useEffect(() => () => sink.current?.stop(), [])
}
