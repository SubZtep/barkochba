import { expect, test } from "bun:test"
import { TimelineItem } from "../../components/timeline"
import type { TimelineEvent } from "../../hooks/use-agent"
import { renderForTest } from "../test-utils"

const events: TimelineEvent[] = [
  { type: "user", text: "hello" },
  { type: "reasoning", text: "SECRET-THOUGHTS" },
  { type: "final", content: "world" }
]

test("thinking toggle shows or hides reasoning on re-render", async () => {
  const t = renderForTest(
    events.map((item, i) => (
      <TimelineItem key={i} item={item} thinking={true} />
    ))
  )
  await t.tick()

  expect(t.output()).toContain("SECRET-THOUGHTS")
  expect(t.output()).toContain("hello")
  expect(t.output()).toContain("world")

  t.rerender(
    events.map((item, i) => (
      <TimelineItem key={i} item={item} thinking={false} />
    ))
  )
  await t.tick()
  expect(t.lastFrame()).toContain("hello")
  expect(t.lastFrame()).toContain("world")
  expect(t.lastFrame()).not.toContain("SECRET-THOUGHTS")

  t.rerender(
    events.map((item, i) => (
      <TimelineItem key={i} item={item} thinking={true} />
    ))
  )
  await t.tick()
  expect(t.lastFrame()).toContain("SECRET-THOUGHTS")

  t.unmount()
  await t.waitUntilExit()
})

test("error events render in the timeline", async () => {
  const t = renderForTest(
    <TimelineItem
      item={{ type: "error", text: "404 Model not found" }}
      thinking={true}
    />
  )
  await t.tick()
  expect(t.output()).toContain("✗ 404 Model not found")

  t.unmount()
  await t.waitUntilExit()
})
