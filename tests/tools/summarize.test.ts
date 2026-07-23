import { expect, mock, test } from "bun:test"

process.env.XDG_CONFIG_HOME = `${import.meta.dir}/../../.tmp-test-xdg-config-summarize`

const { saveConfig } = await import("../../lib/config")
await saveConfig({
  llm: { baseUrl: "http://localhost", apiKey: "test", model: "test-model" }
})

mock.module("../../lib/openai", () => ({
  client: {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: "mocked summary" } }]
        })
      }
    }
  }
}))

const { summarizeTool } = await import("../../tools/summarize")

test("summarize summarizes text", async () => {
  const result = await summarizeTool.execute({ text: "a long story" })
  expect(result).toBe("mocked summary")
})

test("summarize passes through instructions", async () => {
  const result = await summarizeTool.execute({
    text: "a long story",
    instructions: "3 bullet points"
  })
  expect(result).toBe("mocked summary")
})
