import { afterAll, expect, test } from "bun:test"
import { Box } from "ink"
import { StartupPanel } from "../../components/startup-panel"
import { renderForTest } from "../test-utils"

// A tiny stand-in OpenAI-compatible server, same shape as
// tests/lib/model-check.test.ts's — StartupPanel calls the real
// checkModelAvailability, so no mock.module (it replaces modules
// process-wide, not just for this file, and would leak into other test
// files sharing the same bun test process).
let flakyAttempts = 0
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === "/chat/completions") {
      const body = (await req.json()) as { model: string }
      if (body.model === "up-model") {
        return Response.json({
          id: "x",
          choices: [{ message: { role: "assistant", content: "hi" } }]
        })
      }
      if (body.model === "flaky-model") {
        flakyAttempts += 1
        if (flakyAttempts >= 2) {
          return Response.json({
            id: "x",
            choices: [{ message: { role: "assistant", content: "hi" } }]
          })
        }
      }
      return new Response("model not found", { status: 404 })
    }
    if (url.pathname === "/models") {
      return Response.json({ data: [] })
    }
    return new Response("not found", { status: 404 })
  }
})
const baseUrl = `http://localhost:${server.port}`

afterAll(() => {
  server.stop()
})

test("shows persona, grouped models with availability, and stats", async () => {
  const t = renderForTest(
    <Box flexDirection="column" width={80} height={20}>
      <StartupPanel
        persona="Kaja"
        models={[
          { id: "up-model", label: "Up Model", task: "chat", baseUrl },
          { id: "down-model", label: "Down Model", task: "chat", baseUrl },
          { id: "tts-model", task: "text-to-speech", baseUrl }
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

test("retries a failed check and settles on available once it succeeds", async () => {
  const t = renderForTest(
    <Box flexDirection="column" width={80} height={10}>
      <StartupPanel
        persona="Kaja"
        models={[
          {
            id: "flaky-model",
            label: "Flaky Model",
            task: "chat",
            baseUrl
          }
        ]}
        configPath="/config/kaja/config.json"
        sessionCount={0}
        memoryNoteCount={0}
        toolCount={0}
      />
    </Box>
  )
  await t.tick()

  // First attempt fails; stays pending (not "down") while a retry is queued.
  expect(t.lastFrame()).toContain("○ Flaky Model")
  // The retry (RETRY_DELAY_MS later) succeeds.
  await Bun.sleep(4500)
  expect(t.lastFrame()).toContain("✓ Flaky Model")

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

test("lists connected MCP servers with their tool counts", async () => {
  const t = renderForTest(
    <Box flexDirection="column" width={80} height={20}>
      <StartupPanel
        persona="Kaja"
        models={[]}
        mcpServers={[
          { id: "playwright", toolCount: 5 },
          { id: "chrome-devtools", toolCount: 12 }
        ]}
        configPath="/config/kaja/config.json"
        sessionCount={0}
        memoryNoteCount={0}
        toolCount={17}
      />
    </Box>
  )
  await t.tick()

  const frame = t.lastFrame()
  expect(frame).toContain("MCP servers")
  expect(frame).toContain("playwright")
  expect(frame).toContain("(5 tools)")
  expect(frame).toContain("chrome-devtools")
  expect(frame).toContain("(12 tools)")

  t.unmount()
  await t.waitUntilExit()
})

test("omits the MCP servers section when none are connected", async () => {
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

  expect(t.lastFrame()).not.toContain("MCP servers")

  t.unmount()
  await t.waitUntilExit()
})
