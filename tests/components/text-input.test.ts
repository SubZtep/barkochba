import { expect, test } from "bun:test"
import {
  applyTextEdit,
  nextWordBoundary,
  prevWordBoundary,
  type TextEditState
} from "../../components/text-input"

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
  return { value, cursorOffset, cursorWidth: 0 }
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
    cursorWidth: 0
  })
  expect(edit(s, { end: true })).toEqual({
    value: "hello world",
    cursorOffset: 11,
    cursorWidth: 0
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
    cursorWidth: 0
  })
  expect(edit(s, { delete: true })).toEqual({
    value: "abd",
    cursorOffset: 2,
    cursorWidth: 0
  })
  // no-ops at edges
  expect(edit(state("ab", 0), { backspace: true })).toEqual({
    value: "ab",
    cursorOffset: 0,
    cursorWidth: 0
  })
  expect(edit(state("ab", 2), { delete: true })).toEqual({
    value: "ab",
    cursorOffset: 2,
    cursorWidth: 0
  })
})

test("plain insert and paste advance the cursor", () => {
  expect(edit(state("ac", 1), { input: "b" })).toEqual({
    value: "abc",
    cursorOffset: 2,
    cursorWidth: 0
  })
  expect(edit(state("ac", 1), { input: "xyz" })).toEqual({
    value: "axyzc",
    cursorOffset: 4,
    cursorWidth: 3
  })
})

test("Ctrl combinations that are not bindings do not insert", () => {
  // Ctrl+T (dictation toggle) must not type "t"
  expect(edit(state("hi", 2), { ctrl: true, input: "t" })).toBe(null)
  expect(edit(state("hi", 2), { ctrl: true, input: "c" })).toBe(null)
})

test("mouse wheel / kitty protocol noise do not insert text", () => {
  expect(edit(state("hi", 2), { input: "[<64;10;5M" })).toBe(null)
  expect(edit(state("hi", 2), { input: "[<65;1;1m" })).toBe(null)
  // leftover CSI ? flags u from kitty keyboard enable (was prefilling the prompt)
  expect(edit(state("", 0), { input: "[?0u" })).toBe(null)
})

test("return submits; tab/arrows out are ignored", () => {
  expect(edit(state("hi", 2), { return: true })).toBe("submit")
  expect(edit(state("hi", 2), { tab: true })).toBe(null)
  expect(edit(state("hi", 2), { upArrow: true })).toBe(null)
})

test("newline via Shift/Alt/Ctrl+Enter, Ctrl+J, or bare LF", () => {
  const nl = (partial: Parameters<typeof edit>[1]) =>
    expect(edit(state("ab", 1), partial)).toEqual({
      value: "a\nb",
      cursorOffset: 2,
      cursorWidth: 0
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
