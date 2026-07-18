import { useEffect, useRef, useState } from "react"
import { createLocalSource } from "../lib/audio"
import { createStt, type Stt, type SttState } from "../lib/stt"

/**
 * Dictation for the text input: while `listening`, spoken phrases are
 * transcribed (speaches realtime STT with server-side VAD) and delivered one
 * at a time through `onUtterance`. The mic capture and connection spin up
 * lazily on the first listen and are paused — not torn down — when listening
 * stops, so toggling back on is instant. Torn down for real on unmount.
 *
 * Returns the server's current {@link SttState} so the UI can show progress
 * (a slow model spends many seconds in "transcribing").
 */
export function useDictation(
  listening: boolean,
  onUtterance: (text: string) => void
): SttState {
  const [state, setState] = useState<SttState>("listening")
  const stt = useRef<Stt>(undefined)
  const deliver = useRef(onUtterance)
  deliver.current = onUtterance

  useEffect(() => {
    if (!listening) {
      stt.current?.pause()
      return
    }
    if (stt.current) {
      stt.current.resume()
      return
    }
    // Guards against listening being toggled off again before createStt
    // resolves: the stale instance is stopped instead of taking over.
    let cancelled = false
    createStt({
      source: createLocalSource(),
      onState: setState
    }).then(async (instance) => {
      if (cancelled) {
        instance.stop()
        return
      }
      stt.current = instance
      for await (const text of instance.utterances) deliver.current(text)
      // The stream only ends when the stt stopped (server dropped the
      // connection, or an error) — forget it so the next toggle starts fresh
      // instead of resuming a dead instance.
      if (stt.current === instance) stt.current = undefined
      setState("listening")
    })
    return () => {
      cancelled = true
    }
  }, [listening])

  useEffect(() => () => stt.current?.stop(), [])

  return state
}
