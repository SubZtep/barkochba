/**
 * Filter stdin noise that Ink's key parser doesn't swallow: mouse reports,
 * kitty keyboard protocol replies, etc. After ESC is stripped, useInput may
 * hand these to the text field as literal insert text (e.g. `[?0u`).
 */

const ESC = "\u001b"

function stripEsc(input: string): string {
  return input.startsWith(ESC) ? input.slice(1) : input
}

/** True if this looks like a mouse report (wheel, click, drag, …). */
export function isTerminalMouseSequence(input: string): boolean {
  if (!input) return false
  const s = stripEsc(input)
  // SGR: [<btn;x;yM or m
  if (/^\[<\d+;\d+;\d+[Mm]$/.test(s)) return true
  // X10: [M + 3 bytes
  if (/^\[M...$/.test(s)) return true
  return false
}

/**
 * Kitty keyboard protocol replies / mode chatter (CSI … u).
 * Query response looks like CSI ? flags u → after strip: `[?0u`.
 */
export function isKittyKeyboardNoise(input: string): boolean {
  if (!input) return false
  const s = stripEsc(input)
  // CSI ? flags u  |  CSI > flags u  |  CSI < u
  if (/^\[\?\d*u$/.test(s)) return true
  if (/^\[>\d*u$/.test(s)) return true
  if (/^\[<u$/.test(s)) return true
  return false
}

/**
 * Primary Device Attributes (DA1) reply, e.g. `[?1;2c` or `[?63;1;2;6c`.
 * Sent by the terminal in response to a `\x1b[c` / `\x1b[0c` query.
 */
export function isDeviceAttributesReply(input: string): boolean {
  if (!input) return false
  const s = stripEsc(input)
  return /^\[\?\d+(;\d+)*c$/.test(s)
}

/**
 * xterm window/text-area report (XTWINOPS), e.g. `[4;350;848t` (pixel size)
 * or `[8;40;120t` (char size). Sent in response to a `\x1b[14t` / `\x1b[18t`
 * style query.
 */
export function isWindowReport(input: string): boolean {
  if (!input) return false
  const s = stripEsc(input)
  return /^\[\d+(;\d+){0,2}t$/.test(s)
}

/**
 * Some terminals/multiplexers mangle escape-sequence replies into their
 * decimal byte values instead of raw bytes, e.g. `27,91,63,48,117` for
 * `\x1b[?0u`. Any comma-separated byte list starting with 27 (ESC) is noise,
 * not something a human typed.
 */
export function isEscapeByteList(input: string): boolean {
  if (!input) return false
  const parts = input.split(",")
  if (parts.length < 2) return false
  if (!/^\d+$/.test(parts[0]!) || Number(parts[0]) !== 27) return false
  return parts.every((p) => /^\d+$/.test(p) && Number(p) <= 255)
}

/** Any non-text terminal sequence that must not be typed into the input. */
export function isIgnoredTerminalInput(input: string): boolean {
  return (
    isTerminalMouseSequence(input) ||
    isKittyKeyboardNoise(input) ||
    isDeviceAttributesReply(input) ||
    isWindowReport(input) ||
    isEscapeByteList(input)
  )
}

export type WheelDirection = "up" | "down"

/**
 * Decode a wheel tick from a mouse sequence. Returns null for clicks / unknown.
 * SGR wheel: button 64 = up, 65 = down (optionally + shift/meta bits).
 */
export function parseWheelDirection(input: string): WheelDirection | null {
  const s = stripEsc(input)
  // useInput usually strips ESC, so we see `[<64;col;rowM`
  const sgr = s.match(/^\[<(\d+);\d+;\d+[Mm]$/)
  if (sgr) {
    const btn = Number(sgr[1])
    // 64/65 base; low bits may carry modifiers on some terminals
    const base = btn & ~0x1c
    if (base === 64 || btn === 64 || btn === 68) return "up"
    if (base === 65 || btn === 65 || btn === 69) return "down"
    return null
  }
  // X10: button byte is first of the three chars after M, encoded as value+32
  const x10 = s.match(/^\[M(.)..$/)
  if (x10) {
    const btn = (x10[1]!.charCodeAt(0) - 32) & 0x7f
    if (btn === 64) return "up"
    if (btn === 65) return "down"
  }
  return null
}

/** CSI sequences to enable SGR mouse + wheel (and alternate-scroll on altscreen). */
export const MOUSE_ENABLE =
  `${ESC}[?1000h` + // mouse click/drag
  `${ESC}[?1006h` + // SGR encoding
  `${ESC}[?1007h` // alternate scroll (wheel → app on alternate screen)

export const MOUSE_DISABLE = `${ESC}[?1007l` + `${ESC}[?1006l` + `${ESC}[?1000l`
