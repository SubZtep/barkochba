import { expect, test } from "bun:test"
import { runTelegramCli } from "../../lib/telegram-cli"
import type { KajaConfig } from "../../schemas/config"

const baseConfig: KajaConfig = {
  llm: { baseUrl: "https://api.example.test/v1", apiKey: "key", model: "m" }
}

test("without a telegram config block, exits 1 without ever importing telegram-bot", async () => {
  const code = await runTelegramCli({
    config: baseConfig,
    tools: [],
    personas: [],
    models: []
  })
  expect(code).toBe(1)
})
