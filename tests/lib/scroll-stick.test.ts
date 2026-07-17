import { expect, test } from "bun:test"
import { isAtBottom, STICK_SLOP } from "../../lib/scroll-stick"

test("isAtBottom treats slop rows near the end as stuck", () => {
  expect(isAtBottom(100, 100, STICK_SLOP)).toBe(true)
  expect(isAtBottom(98, 100, STICK_SLOP)).toBe(true)
  expect(isAtBottom(97, 100, STICK_SLOP)).toBe(false)
  expect(isAtBottom(0, 0, STICK_SLOP)).toBe(true)
})
