import { expect, spyOn, test } from "bun:test"
import { Box } from "ink"
import { marked } from "marked"
import { ChatViewport } from "../../components/layout/chat-viewport"
import type { TimelineEvent } from "../../hooks/use-agent"
import { renderForTest } from "../test-utils"

const many: TimelineEvent[] = Array.from({ length: 40 }, (_, i) => ({
  type: "user" as const,
  text: `line-${i}-padding-to-force-wrap-and-height`
}))

test("shows recent history and page-up reveals older lines", async () => {
  const t = renderForTest(
    <Box flexDirection="column" width={40} height={12}>
      <ChatViewport
        events={many}
        thinking={false}
        partial={null}
        pending={false}
      />
    </Box>
  )
  await t.tick()
  await t.tick()

  // Pinned to bottom: last lines visible, earliest not necessarily.
  expect(t.lastFrame()).toContain("line-39")
  expect(t.lastFrame()).not.toContain("line-0-padding")

  // Page up should move toward older content and show the follow affordance.
  await t.press("\x1b[5~")
  await t.tick()
  expect(t.lastFrame()).not.toContain("line-39")
  expect(t.lastFrame()).toContain("older")

  // Ctrl+End returns to the bottom and clears the affordance.
  await t.press("\x1b[1;5F")
  await t.tick()
  expect(t.lastFrame()).toContain("line-39")
  expect(t.lastFrame()).not.toContain("older")

  t.unmount()
  await t.waitUntilExit()
})

test("scrolling doesn't re-parse markdown history (memoized)", async () => {
  const mdEvents: TimelineEvent[] = Array.from({ length: 50 }, (_, i) => ({
    type: "message" as const,
    content: `**msg ${i}** with some *markdown* content, line ${i}`
  }))

  const parseSpy = spyOn(marked, "parse")
  const t = renderForTest(
    <Box flexDirection="column" width={40} height={12}>
      <ChatViewport
        events={mdEvents}
        thinking={false}
        partial={null}
        pending={false}
      />
    </Box>
  )
  await t.tick()
  await t.tick()
  // Mount parses each message once.
  expect(parseSpy.mock.calls.length).toBeGreaterThan(0)

  // Scroll ticks re-render the whole ScrollView subtree — with memoization
  // in place, none of the 50 history items may be re-parsed.
  parseSpy.mockClear()
  await t.press("\x1b[5~")
  await t.tick()
  await t.press("\x1b[5~")
  await t.tick()
  expect(parseSpy).toHaveBeenCalledTimes(0)

  parseSpy.mockRestore()
  t.unmount()
  await t.waitUntilExit()
})
