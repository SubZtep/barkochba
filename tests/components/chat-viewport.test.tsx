import { expect, test } from "bun:test"
import { Box } from "ink"
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
