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

/** Huge width ⇒ soft-wrap never fires; only hard `\n` breaks. */
const HARD_LINES_ONLY = 1_000_000

export function layoutLines(text: string, width?: number): VisualLine[] {
  return softWrapLines(text, width && width > 0 ? width : HARD_LINES_ONLY)
}

/**
 * Display-width column of `cursorOffset` within its visual line
 * (emoji-aware via string-width).
 */
export function displayColumnAt(
  lines: VisualLine[],
  cursorOffset: number
): number {
  if (lines.length === 0) return 0
  const line = lines[cursorLineIndex(lines, cursorOffset)]!
  const within = Math.max(
    0,
    Math.min(cursorOffset, line.start + line.text.length) - line.start
  )
  return stringWidth(line.text.slice(0, within))
}

/**
 * Map a preferred display column onto a visual line (clamped to the line end).
 */
export function offsetAtDisplayColumn(
  line: VisualLine,
  preferredCol: number
): number {
  if (preferredCol <= 0 || line.text.length === 0) return line.start
  let col = 0
  let i = 0
  for (const char of line.text) {
    const cw = Math.max(1, stringWidth(char))
    if (col + cw > preferredCol) break
    col += cw
    i += char.length
    if (col === preferredCol) break
  }
  return line.start + i
}

/** Start of the visual line containing `cursorOffset`. */
export function lineStartOffset(
  value: string,
  cursorOffset: number,
  width?: number
): number {
  const lines = layoutLines(value, width)
  return lines[cursorLineIndex(lines, cursorOffset)]!.start
}

/**
 * End of content on the visual line containing `cursorOffset`
 * (before a trailing hard newline, if any).
 */
export function lineEndOffset(
  value: string,
  cursorOffset: number,
  width?: number
): number {
  const lines = layoutLines(value, width)
  const line = lines[cursorLineIndex(lines, cursorOffset)]!
  return line.start + line.text.length
}

/**
 * Move the cursor one visual line up (`-1`) or down (`+1`).
 * Sticky `preferredColumn` is re-seeded from the current position when null.
 * At the first/last line the offset is unchanged but preferred column is still set.
 */
export function moveVertical(
  value: string,
  cursorOffset: number,
  dir: -1 | 1,
  width?: number,
  preferredColumn: number | null = null
): { cursorOffset: number; preferredColumn: number } {
  const lines = layoutLines(value, width)
  const li = cursorLineIndex(lines, cursorOffset)
  const col = preferredColumn ?? displayColumnAt(lines, cursorOffset)
  const target = li + dir
  if (target < 0 || target >= lines.length) {
    return { cursorOffset, preferredColumn: col }
  }
  return {
    cursorOffset: offsetAtDisplayColumn(lines[target]!, col),
    preferredColumn: col
  }
}
