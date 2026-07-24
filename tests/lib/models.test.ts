import { expect, test } from "bun:test"
import { resolveConfigModels } from "../../lib/models"

const llm = {
  baseUrl: "https://api.example.test/v1",
  apiKey: "llm-key",
  model: "m"
}

test("embedding falls back to llm credentials and the default model when unset", () => {
  const models = resolveConfigModels({ llm })
  expect(models).toEqual([
    {
      id: "nomic-ai/nomic-embed-text-v1.5",
      task: "embedding",
      baseUrl: llm.baseUrl,
      apiKey: llm.apiKey
    }
  ])
})

test("embedding uses its own block when configured", () => {
  const models = resolveConfigModels({
    llm,
    embedding: {
      baseUrl: "https://embed.example.test/v1",
      apiKey: "embed-key",
      model: "custom-embedding"
    }
  })
  expect(models).toEqual([
    {
      id: "custom-embedding",
      task: "embedding",
      baseUrl: "https://embed.example.test/v1",
      apiKey: "embed-key"
    }
  ])
})

test("imageGen is included when it names a model", () => {
  const models = resolveConfigModels({
    llm,
    imageGen: {
      baseUrl: "https://images.example.test/v1",
      apiKey: "image-key",
      model: "grok-imagine-image"
    }
  })
  expect(models).toContainEqual({
    id: "grok-imagine-image",
    task: "image-generation",
    baseUrl: "https://images.example.test/v1",
    apiKey: "image-key"
  })
})

test("imageGen without a model is skipped: no id to check against /models", () => {
  const models = resolveConfigModels({
    llm,
    imageGen: { baseUrl: "https://images.example.test/v1", apiKey: "image-key" }
  })
  expect(models.some((m) => m.task === "image-generation")).toBe(false)
})

test("no imageGen block: only embedding is returned", () => {
  const models = resolveConfigModels({ llm })
  expect(models).toHaveLength(1)
  expect(models[0]?.task).toBe("embedding")
})
