/**
 * Shell-style prompt history for the input field: ↑ walks toward older
 * prompts, ↓ back toward newer ones and finally the live draft. Pure and
 * immutable so the exact semantics are unit-testable; the React side is a
 * thin ref wrapper (hooks/use-prompt-history.ts).
 */

export type PromptHistory = {
  /** Newest first. */
  entries: string[]
  /** Index into `entries`, or -1 when the live draft is showing. */
  position: number
  /** What was being typed before recall started, restored by ↓ past newest. */
  draft: string
}

export function createPromptHistory(entries: string[]): PromptHistory {
  return { entries, position: -1, draft: "" }
}

/**
 * One ↑ (`-1`, older) or ↓ (`1`, newer) step. `value` is the text to show,
 * or null when there is nothing further in that direction (history stays
 * unchanged and the input keeps its current text).
 */
export function recall(
  history: PromptHistory,
  dir: -1 | 1,
  current: string
): { history: PromptHistory; value: string | null } {
  const { entries, position } = history

  if (dir === -1) {
    if (position === -1) {
      if (entries.length === 0) return { history, value: null }
      // Leaving the draft: remember it so ↓ can bring it back.
      return {
        history: { ...history, position: 0, draft: current },
        value: entries[0]!
      }
    }
    if (position >= entries.length - 1) return { history, value: null }
    return {
      history: { ...history, position: position + 1 },
      value: entries[position + 1]!
    }
  }

  if (position === -1) return { history, value: null }
  if (position === 0) {
    return { history: { ...history, position: -1 }, value: history.draft }
  }
  return {
    history: { ...history, position: position - 1 },
    value: entries[position - 1]!
  }
}

/**
 * A manual edit makes the current text the new live draft: the recall
 * position resets, so the next ↑ starts from the newest entry again.
 */
export function markEdited(history: PromptHistory): PromptHistory {
  return history.position === -1 ? history : { ...history, position: -1 }
}

/** A submitted prompt becomes the newest entry (unless it already is). */
export function commit(history: PromptHistory, value: string): PromptHistory {
  return {
    entries:
      history.entries[0] === value
        ? history.entries
        : [value, ...history.entries],
    position: -1,
    draft: ""
  }
}
