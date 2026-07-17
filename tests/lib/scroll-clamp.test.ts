import { expect, test } from "bun:test"

/**
 * Mirrors chat-viewport's clamp: scroll must never exceed bottomOffset
 * (contentHeight - viewportHeight), which is what ink-scroll-view gets wrong.
 */
function clampOffset(
  offset: number,
  contentHeight: number,
  viewportHeight: number
): number {
  const bottom = Math.max(0, contentHeight - viewportHeight)
  return Math.max(0, Math.min(offset, bottom))
}

test("cannot scroll past the last line into empty space", () => {
  // 30 rows of content, 10-row viewport → max offset 20
  expect(clampOffset(0, 30, 10)).toBe(0)
  expect(clampOffset(20, 30, 10)).toBe(20)
  expect(clampOffset(30, 30, 10)).toBe(20) // ink-scroll-view would allow 30
  expect(clampOffset(100, 30, 10)).toBe(20)
})

test("short content cannot scroll at all (bottom-aligned via pad, offset 0)", () => {
  // messages 5 + pad 15 = total 20, viewport 20 → bottom 0
  expect(clampOffset(0, 20, 20)).toBe(0)
  expect(clampOffset(5, 20, 20)).toBe(0)
  expect(clampOffset(0, 5, 20)).toBe(0)
})
