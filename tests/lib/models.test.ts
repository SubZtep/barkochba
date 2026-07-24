import { expect, test } from "bun:test"
import { resolveConfigModels } from "../../lib/models"

test("stt without a model is skipped: no id to check against /models", () => {
  const models = resolveConfigModels({})
  expect(models.some((m) => m.task === "speech-to-text")).toBe(false)
})

test("stt falls back to the default speachesUrl (ws:// rewritten to http://) when unset", () => {
  const models = resolveConfigModels({ stt: { model: "custom-stt" } })
  expect(models).toContainEqual({
    id: "custom-stt",
    task: "speech-to-text",
    baseUrl: "http://localhost:8000"
  })
})

test("stt uses its own speachesUrl when configured", () => {
  const models = resolveConfigModels({
    stt: {
      speachesUrl: "ws://speaches.example.test:8000",
      model: "custom-stt"
    }
  })
  expect(models).toContainEqual({
    id: "custom-stt",
    task: "speech-to-text",
    baseUrl: "http://speaches.example.test:8000"
  })
})

test("no stt model configured: nothing is returned", () => {
  const models = resolveConfigModels({})
  expect(models).toHaveLength(0)
})
