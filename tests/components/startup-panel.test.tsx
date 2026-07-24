import { expect, mock, test } from "bun:test"
import { Box } from "ink"
import { renderForTest } from "../test-utils"

mock.module("../../lib/model-check", () => ({
  checkModelAvailability: async (model: { id: string }) =>
    model.id === "up-model"
}))

const { StartupPanel } = await import("../../components/startup-panel")

test("shows persona, grouped models with availability, and stats", async () => {
  const t = renderForTest(
    <Box flexDirection="column" width={80} height={20}>
      <StartupPanel
        persona="Kaja"
        models={[
          { id: "up-model", label: "Up Model", task: "chat", baseUrl: "x" },
          { id: "down-model", label: "Down Model", task: "chat", baseUrl: "x" },
          { id: "tts-model", task: "text-to-speech", baseUrl: "x" }
        ]}
        configPath="/config/kaja/config.json"
        sessionCount={3}
        memoryNoteCount={5}
        toolCount={2}
      />
    </Box>
  )
  await t.tick()
  await t.tick()

  const frame = t.lastFrame()
  expect(frame).toContain("Kaja")
  expect(frame).toContain("Up Model")
  expect(frame).toContain("Down Model")
  expect(frame).toContain("tts-model")
  expect(frame).toContain("/config/kaja/config.json")
  expect(frame).toContain("3")
  expect(frame).toContain("5")
  expect(frame).toContain("2")

  t.unmount()
  await t.waitUntilExit()
})

test("shows a placeholder when no models are configured", async () => {
  const t = renderForTest(
    <Box flexDirection="column" width={80} height={10}>
      <StartupPanel
        persona="Kaja"
        models={[]}
        configPath="/config/kaja/config.json"
        sessionCount={0}
        memoryNoteCount={0}
        toolCount={0}
      />
    </Box>
  )
  await t.tick()

  expect(t.lastFrame()).toContain("No models configured")

  t.unmount()
  await t.waitUntilExit()
})
