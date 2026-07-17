/**
 * Single-line text field for Ink. Vendored from ink-text-input@6 (MIT) and
 * extended with Home/End and Ctrl+←/→ word jumps. Cursor is drawn with
 * inverse video rather than the terminal cursor, which is awkward under Ink.
 */
import { type Key, Text, useInput } from "ink"
import { type ReactNode, useEffect, useState } from "react"

export type TextInputProps = {
  value: string
  onChange: (value: string) => void
  onSubmit?: (value: string) => void
  placeholder?: string
  focus?: boolean
  showCursor?: boolean
  /** Replace every character with this (e.g. "*" for passwords). */
  mask?: string
  highlightPastedText?: boolean
}

export type TextEditState = {
  value: string
  cursorOffset: number
  cursorWidth: number
}

/** Jump left to the start of the previous word (whitespace-delimited). */
export function prevWordBoundary(value: string, cursor: number): number {
  let i = Math.min(Math.max(cursor, 0), value.length)
  while (i > 0 && /\s/.test(value[i - 1]!)) i--
  while (i > 0 && !/\s/.test(value[i - 1]!)) i--
  return i
}

/** Jump right past the current word and following whitespace. */
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

/**
 * Pure key → next state. Exported for unit tests. Returns `null` when the key
 * should be ignored (arrows that leave the field, Ctrl+C, Tab, …).
 */
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
  options: { showCursor: boolean } = { showCursor: true }
): TextEditState | "submit" | null {
  if (
    key.upArrow ||
    key.downArrow ||
    (key.ctrl && input === "c") ||
    key.tab ||
    (key.shift && key.tab)
  ) {
    return null
  }

  if (key.return) return "submit"

  const { value, cursorOffset } = state
  const showCursor = options.showCursor
  let nextCursor = cursorOffset
  let nextValue = value
  let nextCursorWidth = 0

  if (key.home) {
    if (showCursor) nextCursor = 0
  } else if (key.end) {
    if (showCursor) nextCursor = value.length
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
    // Forward delete: drop the character under the cursor.
    if (cursorOffset < value.length) {
      nextValue = value.slice(0, cursorOffset) + value.slice(cursorOffset + 1)
    }
  } else if (key.ctrl || key.meta) {
    // Modified keys (e.g. Ctrl+T for dictation) must not insert text.
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
    cursorWidth: nextCursorWidth
  }
}

function renderCursorText(
  display: string,
  cursorOffset: number,
  cursorWidth: number
): ReactNode {
  if (display.length === 0) {
    return <Text inverse> </Text>
  }

  const parts: ReactNode[] = []
  let i = 0
  for (const char of display) {
    const highlighted = i >= cursorOffset - cursorWidth && i <= cursorOffset
    parts.push(
      highlighted ? (
        <Text key={i} inverse>
          {char}
        </Text>
      ) : (
        <Text key={i}>{char}</Text>
      )
    )
    i++
  }
  if (cursorOffset === display.length) {
    parts.push(
      <Text key="eol" inverse>
        {" "}
      </Text>
    )
  }
  return parts
}

export function TextInput({
  value: originalValue,
  placeholder = "",
  focus = true,
  mask,
  highlightPastedText = false,
  showCursor = true,
  onChange,
  onSubmit
}: TextInputProps) {
  const [state, setState] = useState({
    cursorOffset: originalValue.length,
    cursorWidth: 0
  })
  const { cursorOffset, cursorWidth } = state

  // Keep the cursor inside the string when value changes externally (e.g.
  // dictation appends a phrase while the cursor sat in the middle).
  useEffect(() => {
    setState((prev) => {
      if (!focus || !showCursor) return prev
      if (prev.cursorOffset > originalValue.length) {
        return { cursorOffset: originalValue.length, cursorWidth: 0 }
      }
      return prev
    })
  }, [originalValue, focus, showCursor])

  useInput(
    (input, key) => {
      const result = applyTextEdit(
        {
          value: originalValue,
          cursorOffset,
          cursorWidth
        },
        input,
        key,
        { showCursor }
      )

      if (result === null) return
      if (result === "submit") {
        onSubmit?.(originalValue)
        return
      }

      setState({
        cursorOffset: result.cursorOffset,
        cursorWidth: result.cursorWidth
      })
      if (result.value !== originalValue) onChange(result.value)
    },
    { isActive: focus }
  )

  const display = mask ? mask.repeat(originalValue.length) : originalValue
  const pasteWidth = highlightPastedText ? cursorWidth : 0

  if (showCursor && focus) {
    if (display.length === 0 && placeholder) {
      return (
        <Text>
          <Text inverse>{placeholder[0]}</Text>
          <Text dimColor>{placeholder.slice(1)}</Text>
        </Text>
      )
    }
    if (display.length === 0) {
      return (
        <Text>
          <Text inverse> </Text>
        </Text>
      )
    }
    return <Text>{renderCursorText(display, cursorOffset, pasteWidth)}</Text>
  }

  if (display.length === 0 && placeholder) {
    return <Text dimColor>{placeholder}</Text>
  }
  return <Text>{display}</Text>
}

export default TextInput
