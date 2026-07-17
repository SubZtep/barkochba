import { expect, test } from "bun:test"
import { Timeline } from "../../components/timeline"
import type { TimelineEvent } from "../../hooks/use-agent"
import { renderForTest } from "../test-utils"

const events: TimelineEvent[] = [
  { type: "user", text: "hello" },
  { type: "reasoning", text: "SECRET-THOUGHTS" },
  { type: "final", content: "world" }
]

function timeline(epoch: number, thinking: boolean) {
  return (
    <Timeline
      events={events}
      epoch={epoch}
      thinking={thinking}
      model="test-model"
    />
  )
}

test("epoch remount reprints history with reasoning hidden, then restored", async () => {
  const t = renderForTest(timeline(0, true))
  await t.tick()

  // initial render shows the reasoning box
  expect(t.output()).toContain("SECRET-THOUGHTS")

  // toggling thinking off with an epoch bump reprints history without it
  const afterOff = t.mark()
  t.rerender(timeline(1, false))
  await t.tick()
  expect(afterOff()).toContain("hello")
  expect(afterOff()).toContain("world")
  expect(afterOff()).not.toContain("SECRET-THOUGHTS")

  // toggling back on brings the old reasoning back
  const afterOn = t.mark()
  t.rerender(timeline(2, true))
  await t.tick()
  expect(afterOn()).toContain("SECRET-THOUGHTS")
  expect(afterOn()).toContain("hello")

  t.unmount()
  await t.waitUntilExit()
})

test("error events render in the timeline", async () => {
  const t = renderForTest(
    <Timeline
      events={[
        { type: "user", text: "hi" },
        { type: "error", text: "404 Model not found" }
      ]}
      epoch={0}
      thinking={true}
      model="test-model"
    />
  )
  await t.tick()
  expect(t.output()).toContain("✗ 404 Model not found")

  t.unmount()
  await t.waitUntilExit()
})
