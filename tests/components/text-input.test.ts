import { expect, test } from "bun:test"
import {
  applyTextEdit,
  historyDirection,
  nextWordBoundary,
  prevWordBoundary,
  type TextEditState
} from "../../components/elem/text-input"

const emptyKey = {
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  home: false,
  end: false,
  return: false,
  ctrl: false,
  shift: false,
  tab: false,
  backspace: false,
  delete: false,
  meta: false
}

function state(value: string, cursorOffset: number): TextEditState {
  return { value, cursorOffset, cursorWidth: 0, preferredColumn: null }
}

function edit(
  s: TextEditState,
  partial: Partial<typeof emptyKey> & { input?: string }
) {
  const { input = "", ...flags } = partial
  return applyTextEdit(s, input, { ...emptyKey, ...flags })
}

test("word boundaries skip whitespace and land on word starts", () => {
  const v = "hello  world  there"
  // cursor at end of "world"
  expect(prevWordBoundary(v, 12)).toBe(7)
  // cursor in middle of "world"
  expect(prevWordBoundary(v, 9)).toBe(7)
  // cursor after spaces before "world"
  expect(prevWordBoundary(v, 7)).toBe(0)
  expect(nextWordBoundary(v, 0)).toBe(7)
  expect(nextWordBoundary(v, 7)).toBe(14)
  expect(nextWordBoundary(v, 14)).toBe(v.length)
  expect(prevWordBoundary("", 0)).toBe(0)
  expect(nextWordBoundary("", 0)).toBe(0)
})

test("home and end move the cursor", () => {
  const s = state("hello world", 5)
  expect(edit(s, { home: true })).toEqual({
    value: "hello world",
    cursorOffset: 0,
    cursorWidth: 0,
    preferredColumn: null
  })
  expect(edit(s, { end: true })).toEqual({
    value: "hello world",
    cursorOffset: 11,
    cursorWidth: 0,
    preferredColumn: null
  })
})

test("home/end move within the current line of a multi-line value", () => {
  const v = "ab\ncdef"
  // cursor inside "cdef" (line start 3, content end 7)
  expect(edit(state(v, 5), { home: true })).toMatchObject({ cursorOffset: 3 })
  expect(edit(state(v, 5), { end: true })).toMatchObject({ cursorOffset: 7 })
})

test("up/down move across lines with a sticky column", () => {
  const v = "alpha beta\nab\nlonger line"
  // start at column 6 on the first line
  const down1 = edit(state(v, 6), { downArrow: true }) as TextEditState
  // "ab" is shorter than column 6 → clamp to its end, keep preferred column
  expect(down1).toMatchObject({ cursorOffset: 13, preferredColumn: 6 })
  const down2 = edit(down1, { downArrow: true }) as TextEditState
  expect(down2).toMatchObject({ cursorOffset: 20, preferredColumn: 6 })
  const up = edit(down2, { upArrow: true }) as TextEditState
  expect(up).toMatchObject({ cursorOffset: 13, preferredColumn: 6 })
  // horizontal movement drops the sticky column
  expect(edit(up, { leftArrow: true })).toMatchObject({
    cursorOffset: 12,
    preferredColumn: null
  })
})

test("up on first line / down on last line keep the cursor", () => {
  expect(edit(state("hi", 1), { upArrow: true })).toEqual({
    value: "hi",
    cursorOffset: 1,
    cursorWidth: 0,
    preferredColumn: 1
  })
  expect(edit(state("hi", 1), { downArrow: true })).toEqual({
    value: "hi",
    cursorOffset: 1,
    cursorWidth: 0,
    preferredColumn: 1
  })
})

test("arrows move by char; Ctrl/Meta+arrows by word", () => {
  const s = state("foo bar baz", 7)
  expect(edit(s, { leftArrow: true })).toMatchObject({ cursorOffset: 6 })
  expect(edit(s, { rightArrow: true })).toMatchObject({ cursorOffset: 8 })
  expect(edit(s, { leftArrow: true, ctrl: true })).toMatchObject({
    cursorOffset: 4
  })
  expect(edit(s, { rightArrow: true, ctrl: true })).toMatchObject({
    cursorOffset: 8
  })
  expect(edit(s, { leftArrow: true, meta: true })).toMatchObject({
    cursorOffset: 4
  })
})

test("backspace deletes left; delete deletes under cursor", () => {
  const s = state("abcd", 2)
  expect(edit(s, { backspace: true })).toEqual({
    value: "acd",
    cursorOffset: 1,
    cursorWidth: 0,
    preferredColumn: null
  })
  expect(edit(s, { delete: true })).toEqual({
    value: "abd",
    cursorOffset: 2,
    cursorWidth: 0,
    preferredColumn: null
  })
  // no-ops at edges
  expect(edit(state("ab", 0), { backspace: true })).toEqual({
    value: "ab",
    cursorOffset: 0,
    cursorWidth: 0,
    preferredColumn: null
  })
  expect(edit(state("ab", 2), { delete: true })).toEqual({
    value: "ab",
    cursorOffset: 2,
    cursorWidth: 0,
    preferredColumn: null
  })
})

test("plain insert and paste advance the cursor", () => {
  expect(edit(state("ac", 1), { input: "b" })).toEqual({
    value: "abc",
    cursorOffset: 2,
    cursorWidth: 0,
    preferredColumn: null
  })
  expect(edit(state("ac", 1), { input: "xyz" })).toEqual({
    value: "axyzc",
    cursorOffset: 4,
    cursorWidth: 3,
    preferredColumn: null
  })
})

test("Ctrl combinations that are not bindings do not insert", () => {
  // Ctrl+T (dictation toggle) must not type "t"
  expect(edit(state("hi", 2), { ctrl: true, input: "t" })).toBe(null)
  expect(edit(state("hi", 2), { ctrl: true, input: "c" })).toBe(null)
  // Ctrl+A/E are intentionally unbound (no secondary line-start/end keys)
  expect(edit(state("ab\ncd", 4), { ctrl: true, input: "a" })).toBe(null)
  expect(edit(state("ab\ncd", 4), { ctrl: true, input: "e" })).toBe(null)
})

test("mouse wheel / kitty protocol noise do not insert text", () => {
  expect(edit(state("hi", 2), { input: "[<64;10;5M" })).toBe(null)
  expect(edit(state("hi", 2), { input: "[<65;1;1m" })).toBe(null)
  // leftover CSI ? flags u from kitty keyboard enable (was prefilling the prompt)
  expect(edit(state("", 0), { input: "[?0u" })).toBe(null)
})

test("return submits; tab/Ctrl+arrows out are ignored", () => {
  expect(edit(state("hi", 2), { return: true })).toBe("submit")
  expect(edit(state("hi", 2), { tab: true })).toBe(null)
  // viewport owns Ctrl/Meta+↑/↓ scrolling
  expect(edit(state("hi", 2), { upArrow: true, ctrl: true })).toBe(null)
  expect(edit(state("hi", 2), { downArrow: true, meta: true })).toBe(null)
})

test("newline via Shift/Alt/Ctrl+Enter, Ctrl+J, or bare LF", () => {
  const nl = (partial: Parameters<typeof edit>[1]) =>
    expect(edit(state("ab", 1), partial)).toEqual({
      value: "a\nb",
      cursorOffset: 2,
      cursorWidth: 0,
      preferredColumn: null
    })
  nl({ return: true, shift: true })
  nl({ return: true, meta: true })
  nl({ return: true, ctrl: true })
  nl({ ctrl: true, input: "j" })
  nl({ input: "\n" })
})

test("cursor is clamped after edits", () => {
  expect(edit(state("ab", 0), { leftArrow: true })).toMatchObject({
    cursorOffset: 0
  })
  expect(edit(state("ab", 2), { rightArrow: true })).toMatchObject({
    cursorOffset: 2
  })
})

const arrow = (up: boolean, mods: { ctrl?: boolean; meta?: boolean } = {}) => ({
  upArrow: up,
  downArrow: !up,
  ctrl: mods.ctrl ?? false,
  meta: mods.meta ?? false
})

test("historyDirection: single-line and empty input recall both ways", () => {
  expect(historyDirection("", 0, arrow(true))).toBe(-1)
  expect(historyDirection("", 0, arrow(false))).toBe(1)
  expect(historyDirection("hello", 3, arrow(true))).toBe(-1)
  expect(historyDirection("hello", 3, arrow(false))).toBe(1)
})

test("historyDirection: multiline recalls only where the cursor can't move", () => {
  const v = "a\nb\nc"
  // middle line: both directions are cursor movement
  expect(historyDirection(v, 2, arrow(true))).toBe(null)
  expect(historyDirection(v, 2, arrow(false))).toBe(null)
  // first line: up recalls, down moves
  expect(historyDirection(v, 0, arrow(true))).toBe(-1)
  expect(historyDirection(v, 0, arrow(false))).toBe(null)
  // last line: down recalls, up moves
  expect(historyDirection(v, 4, arrow(false))).toBe(1)
  expect(historyDirection(v, 4, arrow(true))).toBe(null)
})

test("historyDirection: soft-wrapped lines count as lines", () => {
  // "aaaa bbbb" at width 4 wraps to "aaaa" / "bbbb"
  const v = "aaaa bbbb"
  expect(historyDirection(v, 7, arrow(true), 4)).toBe(null)
  expect(historyDirection(v, 7, arrow(false), 4)).toBe(1)
  expect(historyDirection(v, 1, arrow(true), 4)).toBe(-1)
  expect(historyDirection(v, 1, arrow(false), 4)).toBe(null)
})

test("historyDirection: Ctrl/Meta combos and non-vertical keys stay null", () => {
  expect(historyDirection("hi", 1, arrow(true, { ctrl: true }))).toBe(null)
  expect(historyDirection("hi", 1, arrow(false, { meta: true }))).toBe(null)
  expect(
    historyDirection("hi", 1, {
      upArrow: false,
      downArrow: false,
      ctrl: false,
      meta: false
    })
  ).toBe(null)
})
