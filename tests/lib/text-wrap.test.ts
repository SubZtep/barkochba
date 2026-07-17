import { expect, test } from "bun:test"
import {
  clampWindowStart,
  cursorLineIndex,
  softWrapLines
} from "../../lib/text-wrap"

test("softWrapLines breaks on column width", () => {
  const lines = softWrapLines("abcdefghij", 4)
  expect(lines.map((l) => l.text)).toEqual(["abcd", "efgh", "ij"])
  expect(lines[0]).toMatchObject({ start: 0, end: 4 })
  expect(lines[1]).toMatchObject({ start: 4, end: 8 })
  expect(lines[2]).toMatchObject({ start: 8, end: 10 })
})

test("softWrapLines empty string is one empty line", () => {
  expect(softWrapLines("", 10)).toEqual([{ start: 0, end: 0, text: "" }])
})

test("softWrapLines hard-breaks on newlines", () => {
  const lines = softWrapLines("ab\ncd", 10)
  expect(lines.map((l) => l.text)).toEqual(["ab", "cd"])
  expect(lines[0]).toMatchObject({ start: 0, end: 3 })
  expect(lines[1]).toMatchObject({ start: 3, end: 5 })
  // cursor after `\n` is on the second line
  expect(cursorLineIndex(lines, 3)).toBe(1)
})

test("cursorLineIndex maps offsets onto visual lines", () => {
  const lines = softWrapLines("abcdefghij", 4)
  expect(cursorLineIndex(lines, 0)).toBe(0)
  expect(cursorLineIndex(lines, 3)).toBe(0)
  // At soft wrap boundary, cursor sits on the next line
  expect(cursorLineIndex(lines, 4)).toBe(1)
  expect(cursorLineIndex(lines, 10)).toBe(2)
})

test("clampWindowStart keeps cursor line in view", () => {
  expect(clampWindowStart(0, 0, 3, 10)).toBe(0)
  expect(clampWindowStart(5, 0, 3, 10)).toBe(3) // 5 not in [0,3) → start=3
  expect(clampWindowStart(2, 2, 3, 10)).toBe(2)
  expect(clampWindowStart(1, 2, 3, 10)).toBe(1) // scroll up
  expect(clampWindowStart(9, 0, 3, 10)).toBe(7)
})
