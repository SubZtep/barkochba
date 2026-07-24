/**
 * Text field for Ink. Vendored from ink-text-input@6 (MIT) and extended with
 * multi-line navigation (↑/↓ with sticky column, Home/End per visual line),
 * Ctrl+←/→ word jumps, Shift+Enter newlines, mouse-sequence ignore, and a
 * soft-wrap display window so long drafts stay editable inside maxVisibleLines.
 *
 * Multi-line paint is one <Text> with embedded \\n and chalk.inverse for the
 * cursor so every row shares the same origin (no sibling-Text skew).
 *
 * Ctrl+↑/↓ are left unhandled so the chat viewport can scroll.
 */

import chalk from "chalk"
import { type Key, Text, useInput } from "ink"
import { useEffect, useMemo, useState } from "react"
import { isIgnoredTerminalInput } from "../../lib/terminal-input"
import {
  clampWindowStart,
  cursorLineIndex,
  layoutLines,
  lineEndOffset,
  lineStartOffset,
  moveVertical,
  softWrapLines,
  type VisualLine
} from "../../lib/text-wrap"

export type TextInputProps = {
  value: string
  onChange: (value: string) => void
  onSubmit?: (value: string) => void
  placeholder?: string
  focus?: boolean
  showCursor?: boolean
  /**
   * Rendering-only: paints the cursor inverse when true, plain when false —
   * for a blink. Never gates movement/editing (unlike {@link showCursor}).
   * Defaults to `showCursor` so callers that don't blink see no change.
   */
  cursorVisible?: boolean
  mask?: string
  highlightPastedText?: boolean
  columns?: number
  maxVisibleLines?: number
  /**
   * First-line-only status mark (ASCII, fixed width). Continuation lines use
   * `prefixCols` spaces so every row is the same length.
   */
  prefix?: string
  /** Column budget for prefix / hang-indent (must match prefix width). */
  prefixCols?: number
  /**
   * Shell-style ↑/↓ prompt recall, consulted only where the cursor has no
   * line to move to (see {@link historyDirection}). Returns the replacement
   * text — which the parent must have applied to `value` itself — or null
   * to leave the input alone. `onChange` is deliberately not called for
   * recalls, so it stays a reliable "human edited" signal.
   */
  onHistory?: (dir: -1 | 1, current: string) => string | null
}

export type TextEditState = {
  value: string
  cursorOffset: number
  cursorWidth: number
  /**
   * Sticky display column for ↑/↓. `null` means re-seed from the current
   * position on the next vertical move.
   */
  preferredColumn: number | null
}

/**
 * Whether an ↑/↓ press should recall history instead of moving the cursor:
 * exactly when {@link moveVertical} would refuse the move — ↑ with the
 * cursor already on the first visual line (`-1`), ↓ on the last (`1`).
 * A single-line or empty input is both, like a shell prompt. Ctrl/Meta
 * combos stay null — the chat viewport owns those for scrolling.
 */
export function historyDirection(
  value: string,
  cursorOffset: number,
  key: Pick<Key, "upArrow" | "downArrow" | "ctrl" | "meta">,
  columns?: number
): -1 | 1 | null {
  if (key.ctrl || key.meta) return null
  if (!key.upArrow && !key.downArrow) return null
  const lines = layoutLines(value, columns)
  const line = cursorLineIndex(lines, cursorOffset)
  if (key.upArrow && line === 0) return -1
  if (key.downArrow && line === lines.length - 1) return 1
  return null
}

export function prevWordBoundary(value: string, cursor: number): number {
  let i = Math.min(Math.max(cursor, 0), value.length)
  while (i > 0 && /\s/.test(value[i - 1]!)) i--
  while (i > 0 && !/\s/.test(value[i - 1]!)) i--
  return i
}

export function nextWordBoundary(value: string, cursor: number): number {
  let i = Math.min(Math.max(cursor, 0), value.length)
  while (i < value.length && !/\s/.test(value[i]!)) i++
  while (i < value.length && /\s/.test(value[i]!)) i++
  return i
}

function clampCursor(offset: number, length: number): number {
  if (offset < 0) return 0
  if (offset > length) return length
  return offset
}

export function applyTextEdit(
  state: TextEditState,
  input: string,
  key: Pick<
    Key,
    | "upArrow"
    | "downArrow"
    | "leftArrow"
    | "rightArrow"
    | "home"
    | "end"
    | "return"
    | "ctrl"
    | "shift"
    | "tab"
    | "backspace"
    | "delete"
    | "meta"
  >,
  options: {
    showCursor: boolean
    /** Soft-wrap column budget; omit for hard-newline layout only. */
    columns?: number
  } = { showCursor: true }
): TextEditState | "submit" | null {
  if (isIgnoredTerminalInput(input)) return null

  // Viewport owns Ctrl/Meta+↑/↓; tab is unused here.
  if (
    ((key.upArrow || key.downArrow) && (key.ctrl || key.meta)) ||
    (key.ctrl && input === "c") ||
    key.tab ||
    (key.shift && key.tab)
  ) {
    return null
  }

  const { value, cursorOffset, preferredColumn } = state
  const columns = options.columns

  const insertNewline =
    (key.return && (key.shift || key.meta || key.ctrl)) ||
    (key.ctrl && (input === "j" || input === "J")) ||
    (!key.return && input === "\n")

  if (insertNewline) {
    return {
      value: `${value.slice(0, cursorOffset)}\n${value.slice(cursorOffset)}`,
      cursorOffset: cursorOffset + 1,
      cursorWidth: 0,
      preferredColumn: null
    }
  }
  if (key.return) return "submit"

  const showCursor = options.showCursor
  let nextCursor = cursorOffset
  let nextValue = value
  let nextCursorWidth = 0
  const nextPreferred: number | null = null

  if (key.upArrow || key.downArrow) {
    if (!showCursor) return null
    const moved = moveVertical(
      value,
      cursorOffset,
      key.upArrow ? -1 : 1,
      columns,
      preferredColumn
    )
    return {
      value,
      cursorOffset: moved.cursorOffset,
      cursorWidth: 0,
      preferredColumn: moved.preferredColumn
    }
  }

  if (key.home) {
    if (showCursor) nextCursor = lineStartOffset(value, cursorOffset, columns)
  } else if (key.end) {
    if (showCursor) nextCursor = lineEndOffset(value, cursorOffset, columns)
  } else if (key.leftArrow && (key.ctrl || key.meta)) {
    if (showCursor) nextCursor = prevWordBoundary(value, cursorOffset)
  } else if (key.rightArrow && (key.ctrl || key.meta)) {
    if (showCursor) nextCursor = nextWordBoundary(value, cursorOffset)
  } else if (key.leftArrow) {
    if (showCursor) nextCursor = cursorOffset - 1
  } else if (key.rightArrow) {
    if (showCursor) nextCursor = cursorOffset + 1
  } else if (key.backspace) {
    if (cursorOffset > 0) {
      nextValue = value.slice(0, cursorOffset - 1) + value.slice(cursorOffset)
      nextCursor = cursorOffset - 1
    }
  } else if (key.delete) {
    if (cursorOffset < value.length) {
      nextValue = value.slice(0, cursorOffset) + value.slice(cursorOffset + 1)
    }
  } else if (key.ctrl || key.meta) {
    return null
  } else if (input) {
    nextValue = value.slice(0, cursorOffset) + input + value.slice(cursorOffset)
    nextCursor = cursorOffset + input.length
    if (input.length > 1) nextCursorWidth = input.length
  } else {
    return null
  }

  nextCursor = clampCursor(nextCursor, nextValue.length)
  return {
    value: nextValue,
    cursorOffset: nextCursor,
    cursorWidth: nextCursorWidth,
    preferredColumn: nextPreferred
  }
}

/** Paint one visual line with optional inverse cursor (chalk, one string). */
export function paintLineWithCursor(
  line: VisualLine,
  isLastLine: boolean,
  cursorOffset: number,
  cursorWidth: number,
  showCursor: boolean
): string {
  const { text, start, end } = line
  if (!showCursor) return text.length === 0 ? " " : text

  const cursorOnLine =
    cursorOffset >= start &&
    (cursorOffset < end || (isLastLine && cursorOffset <= end))

  if (!cursorOnLine) return text.length === 0 ? " " : text
  if (text.length === 0) return chalk.inverse(" ")

  let out = ""
  let i = 0
  for (const char of text) {
    const abs = start + i
    const highlighted = abs >= cursorOffset - cursorWidth && abs <= cursorOffset
    out += highlighted ? chalk.inverse(char) : char
    i += char.length
  }
  if (isLastLine && cursorOffset === end) {
    out += chalk.inverse(" ")
  }
  return out
}

export function TextInput({
  value: originalValue,
  placeholder = "",
  focus = true,
  mask,
  highlightPastedText = false,
  showCursor = true,
  cursorVisible = showCursor,
  onChange,
  onSubmit,
  onHistory,
  columns,
  maxVisibleLines,
  prefix = "",
  prefixCols = 0
}: TextInputProps) {
  const [state, setState] = useState({
    cursorOffset: originalValue.length,
    cursorWidth: 0,
    preferredColumn: null as number | null
  })
  const [windowStart, setWindowStart] = useState(0)
  const { cursorOffset, cursorWidth, preferredColumn } = state
  const hang = Math.max(0, prefixCols)
  const firstLead = prefix
  const contLead = hang > 0 ? " ".repeat(hang) : ""
  const wrapWidth = columns && columns > 0 ? columns : undefined

  useEffect(() => {
    setState((prev) => {
      if (!focus || !showCursor) return prev
      if (prev.cursorOffset > originalValue.length) {
        return {
          cursorOffset: originalValue.length,
          cursorWidth: 0,
          preferredColumn: null
        }
      }
      return prev
    })
  }, [originalValue, focus, showCursor])

  useInput(
    (input, key) => {
      if (onHistory && showCursor) {
        const dir = historyDirection(
          originalValue,
          cursorOffset,
          key,
          wrapWidth
        )
        if (dir !== null) {
          const replaced = onHistory(dir, originalValue)
          if (replaced !== null) {
            setState({
              cursorOffset: replaced.length,
              cursorWidth: 0,
              preferredColumn: null
            })
            return
          }
          // Nothing in that direction: fall through to the normal no-op.
        }
      }

      const result = applyTextEdit(
        {
          value: originalValue,
          cursorOffset,
          cursorWidth,
          preferredColumn
        },
        input,
        key,
        { showCursor, columns: wrapWidth }
      )

      if (result === null) return
      if (result === "submit") {
        onSubmit?.(originalValue)
        return
      }

      setState({
        cursorOffset: result.cursorOffset,
        cursorWidth: result.cursorWidth,
        preferredColumn: result.preferredColumn
      })
      if (result.value !== originalValue) onChange(result.value)
    },
    { isActive: focus }
  )

  const display = mask ? mask.repeat(originalValue.length) : originalValue
  const pasteWidth = highlightPastedText ? cursorWidth : 0
  const maxVis =
    maxVisibleLines && maxVisibleLines > 0 ? maxVisibleLines : undefined

  const lines = useMemo(
    () => (wrapWidth && maxVis ? softWrapLines(display, wrapWidth) : null),
    [display, wrapWidth, maxVis]
  )

  useEffect(() => {
    if (!lines || !maxVis) return
    const cLine = cursorLineIndex(lines, cursorOffset)
    setWindowStart((prev) =>
      clampWindowStart(cLine, prev, maxVis, lines.length)
    )
  }, [lines, cursorOffset, maxVis])

  if (lines && maxVis) {
    const start = clampWindowStart(
      cursorLineIndex(lines, cursorOffset),
      windowStart,
      maxVis,
      lines.length
    )
    const visible = lines.slice(start, start + maxVis)
    const active = showCursor && cursorVisible && focus

    if (display.length === 0 && placeholder) {
      const head = active
        ? chalk.inverse(placeholder[0] ?? " ") + chalk.dim(placeholder.slice(1))
        : chalk.dim(placeholder)
      return <Text>{firstLead + head}</Text>
    }

    const painted = visible
      .map((line, vi) => {
        const absLine = start + vi
        const isLast = absLine === lines.length - 1
        const body = paintLineWithCursor(
          line,
          isLast,
          cursorOffset,
          pasteWidth,
          active
        )
        return (absLine === 0 ? firstLead : contLead) + body
      })
      .join("\n")

    return <Text>{painted}</Text>
  }

  if (showCursor && focus) {
    if (display.length === 0 && placeholder) {
      return (
        <Text>
          {firstLead}
          {cursorVisible
            ? chalk.inverse(placeholder[0] ?? " ") +
              chalk.dim(placeholder.slice(1))
            : chalk.dim(placeholder)}
        </Text>
      )
    }
    if (display.length === 0) {
      return (
        <Text>
          {firstLead}
          {cursorVisible ? chalk.inverse(" ") : " "}
        </Text>
      )
    }
    const line: VisualLine = {
      start: 0,
      end: display.length,
      text: display
    }
    return (
      <Text>
        {firstLead}
        {paintLineWithCursor(
          line,
          true,
          cursorOffset,
          pasteWidth,
          cursorVisible
        )}
      </Text>
    )
  }

  if (display.length === 0 && placeholder) {
    return (
      <Text dimColor>
        {firstLead}
        {placeholder}
      </Text>
    )
  }
  return (
    <Text>
      {firstLead}
      {display}
    </Text>
  )
}

export default TextInput
