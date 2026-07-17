/** Rows from the true bottom that still count as “following the tail”. */
export const STICK_SLOP = 2

/**
 * Whether the scroll offset is near enough to the bottom to keep auto-follow.
 * Pure helper for tests and ChatViewport.
 */
export function isAtBottom(
  scrollOffset: number,
  bottomOffset: number,
  slop: number = STICK_SLOP
): boolean {
  return scrollOffset >= Math.max(0, bottomOffset - slop)
}
