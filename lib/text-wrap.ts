import stringWidth from "string-width"

export type VisualLine = {
  /** Inclusive start offset into the original string. */
  start: number
  /** Exclusive end offset into the original string. */
  end: number
  text: string
}

/**
 * Soft-wrap `text` to `width` terminal columns (emoji-aware via string-width).
 * Hard newlines (`\n`) always break. Empty string yields a single empty line
 * so the cursor has a row to sit on.
 */
export function softWrapLines(text: string, width: number): VisualLine[] {
  const w = Math.max(1, Math.floor(width))
  if (text.length === 0) {
    return [{ start: 0, end: 0, text: "" }]
  }

  const lines: VisualLine[] = []
  let lineStart = 0
  let lineText = ""
  let lineW = 0
  let i = 0

  for (const char of text) {
    if (char === "\n") {
      // end is exclusive and includes the newline so the cursor after `\n`
      // lands on the following visual line.
      lines.push({
        start: lineStart,
        end: i + 1,
        text: lineText
      })
      lineStart = i + 1
      lineText = ""
      lineW = 0
      i += 1
      continue
    }
    // Soft-wrap: don't begin a visual line with a space (looks like indent).
    if (char === " " && lineText.length === 0) {
      i += 1
      lineStart = i
      continue
    }
    const cw = Math.max(1, stringWidth(char))
    if (lineW + cw > w && lineText.length > 0) {
      lines.push({
        start: lineStart,
        end: i,
        text: lineText
      })
      // Skip spaces at the wrap point so the next line doesn't start indented.
      if (char === " ") {
        lineStart = i + 1
        lineText = ""
        lineW = 0
      } else {
        lineStart = i
        lineText = char
        lineW = cw
      }
    } else {
      lineText += char
      lineW += cw
    }
    i += char.length
  }

  lines.push({ start: lineStart, end: i, text: lineText })
  return lines
}

/** Visual line index that contains the cursor (cursor may be at end of string). */
export function cursorLineIndex(
  lines: VisualLine[],
  cursorOffset: number
): number {
  if (lines.length === 0) return 0
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!
    const last = li === lines.length - 1
    if (cursorOffset < line.end || (last && cursorOffset <= line.end)) {
      // Cursor at soft-wrap boundary sits on the next line (except true EOL).
      if (!last && cursorOffset === line.end) continue
      return li
    }
  }
  return lines.length - 1
}

/**
 * Keep `cursorLine` inside the visible window `[windowStart, windowStart + maxVisible)`.
 */
export function clampWindowStart(
  cursorLine: number,
  windowStart: number,
  maxVisible: number,
  totalLines: number
): number {
  const maxVis = Math.max(1, maxVisible)
  const maxStart = Math.max(0, totalLines - maxVis)
  let start = Math.min(Math.max(0, windowStart), maxStart)
  if (cursorLine < start) start = cursorLine
  if (cursorLine >= start + maxVis) start = cursorLine - maxVis + 1
  return Math.min(Math.max(0, start), maxStart)
}
