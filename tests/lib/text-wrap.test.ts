import { expect, test } from "bun:test"
import {
  clampWindowStart,
  cursorLineIndex,
  displayColumnAt,
  lineEndOffset,
  lineStartOffset,
  moveVertical,
  offsetAtDisplayColumn,
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

test("lineStartOffset/lineEndOffset on hard newlines", () => {
  const v = "ab\ncdef"
  // cursor inside "cdef" (start 3, content end 7, before any trailing \n)
  expect(lineStartOffset(v, 5)).toBe(3)
  expect(lineEndOffset(v, 5)).toBe(7)
  expect(lineStartOffset(v, 1)).toBe(0)
  expect(lineEndOffset(v, 1)).toBe(2)
})

test("lineStartOffset/lineEndOffset respect soft wrap width", () => {
  const v = "abcdefghij"
  // width 4 → "abcd" / "efgh" / "ij"; cursor 6 is on the middle line
  expect(lineStartOffset(v, 6, 4)).toBe(4)
  expect(lineEndOffset(v, 6, 4)).toBe(8)
  // no width → single hard line
  expect(lineStartOffset(v, 6)).toBe(0)
  expect(lineEndOffset(v, 6)).toBe(10)
})

test("moveVertical steps between hard lines with sticky column", () => {
  const v = "abcd\nxy\nefgh"
  // col 3 down onto "xy" clamps to its end but keeps the preferred column
  const down1 = moveVertical(v, 3, 1)
  expect(down1).toEqual({ cursorOffset: 7, preferredColumn: 3 })
  // next step restores col 3 on "efgh"
  const down2 = moveVertical(v, down1.cursorOffset, 1, undefined, 3)
  expect(down2).toEqual({ cursorOffset: 11, preferredColumn: 3 })
  const up = moveVertical(v, down2.cursorOffset, -1, undefined, 3)
  expect(up).toEqual({ cursorOffset: 7, preferredColumn: 3 })
})

test("moveVertical steps between soft-wrapped lines", () => {
  const v = "abcdefghij"
  // width 4 → "abcd" / "efgh" / "ij"
  expect(moveVertical(v, 2, 1, 4)).toEqual({
    cursorOffset: 6,
    preferredColumn: 2
  })
  expect(moveVertical(v, 6, -1, 4)).toEqual({
    cursorOffset: 2,
    preferredColumn: 2
  })
})

test("moveVertical at the edges keeps the offset", () => {
  expect(moveVertical("ab\ncd", 1, -1)).toEqual({
    cursorOffset: 1,
    preferredColumn: 1
  })
  expect(moveVertical("ab\ncd", 4, 1)).toEqual({
    cursorOffset: 4,
    preferredColumn: 1
  })
})

test("display columns are emoji-aware", () => {
  // 🐓 is 2 columns wide and 2 UTF-16 units long
  const lines = softWrapLines("🐓ab", 10)
  expect(displayColumnAt(lines, 2)).toBe(2)
  expect(displayColumnAt(lines, 3)).toBe(3)
  const line = lines[0]!
  expect(offsetAtDisplayColumn(line, 2)).toBe(2)
  // a wide char can't be split: col 1 stays before the emoji
  expect(offsetAtDisplayColumn(line, 1)).toBe(0)
  // past the end clamps to line end
  expect(offsetAtDisplayColumn(line, 99)).toBe(4)
})
