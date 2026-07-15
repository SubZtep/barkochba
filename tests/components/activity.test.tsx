import { expect, test } from "bun:test"
import { Activity } from "../../components/activity"
import { renderForTest } from "../test-utils"

test("shows the indicator while reasoning streams with thinking hidden", async () => {
  const t = renderForTest(
    <Activity
      pending={true}
      partial={{ reasoning: "x".repeat(40), content: "" }}
      thinking={false}
    />
  )
  await t.tick()
  expect(t.lastFrame()).toContain("Thinking…")
  expect(t.lastFrame()).toContain("~10 tokens")

  t.unmount()
  await t.waitUntilExit()
})

test("shows before the first token arrives", async () => {
  const t = renderForTest(
    <Activity pending={true} partial={null} thinking={true} />
  )
  await t.tick()
  expect(t.lastFrame()).toContain("Thinking…")

  t.unmount()
  await t.waitUntilExit()
})

test("hidden when content streams, reasoning is visible, or run is done", async () => {
  const cases = [
    {
      pending: true,
      partial: { reasoning: "", content: "No." },
      thinking: false
    },
    {
      pending: true,
      partial: { reasoning: "hmm", content: "" },
      thinking: true
    },
    { pending: false, partial: null, thinking: false }
  ]
  for (const props of cases) {
    const t = renderForTest(<Activity {...props} />)
    await t.tick()
    expect(t.output()).not.toContain("Thinking…")
    t.unmount()
    await t.waitUntilExit()
  }
})
