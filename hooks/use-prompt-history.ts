import { useMemo, useRef } from "react"
import {
  commit,
  createPromptHistory,
  markEdited,
  type PromptHistory,
  recall
} from "../lib/prompt-history"

/**
 * Holds a {@link PromptHistory} in a ref — recall never re-renders by
 * itself; the recalled text flows back through the caller's own input
 * state. `initial` (prompts loaded from the session store, newest first)
 * only seeds the machine on mount.
 */
export function usePromptHistory(initial: string[]) {
  const historyRef = useRef<PromptHistory>(undefined)
  if (!historyRef.current) historyRef.current = createPromptHistory(initial)

  return useMemo(
    () => ({
      /** Step ↑/↓; returns the text to show, or null to leave it alone. */
      recall(dir: -1 | 1, current: string): string | null {
        const result = recall(historyRef.current!, dir, current)
        historyRef.current = result.history
        return result.value
      },
      markEdited() {
        historyRef.current = markEdited(historyRef.current!)
      },
      commit(value: string) {
        historyRef.current = commit(historyRef.current!, value)
      }
    }),
    []
  )
}
