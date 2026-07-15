import { expect, test } from "bun:test"
import { TOML } from "bun"
import { resolveModels } from "../../lib/models"
import { ModelsFileSchema } from "../../schemas/models"

const parse = (toml: string) => ModelsFileSchema.parse(TOML.parse(toml))

const VALID = `
[providers.default]
base_url = "https://api.fireworks.ai/inference/v1"
api_key = "fw-test"

[providers.speaches]
base_url = "http://localhost:8000"

[[models]]
id = "accounts/fireworks/models/deepseek"
label = "DeepSeek fast"
task = "chat"

[[models]]
id = "speaches-ai/Kokoro-82M-v1.0-ONNX-fp16"
task = "text-to-speech"
provider = "speaches"
`

test("valid file parses and resolves provider credentials", () => {
  const models = resolveModels(parse(VALID))
  expect(models).toEqual([
    {
      id: "accounts/fireworks/models/deepseek",
      label: "DeepSeek fast",
      task: "chat",
      baseUrl: "https://api.fireworks.ai/inference/v1",
      apiKey: "fw-test"
    },
    {
      id: "speaches-ai/Kokoro-82M-v1.0-ONNX-fp16",
      label: undefined,
      task: "text-to-speech",
      baseUrl: "http://localhost:8000",
      apiKey: undefined
    }
  ])
})

test("empty file parses to no providers and no models", () => {
  expect(parse("")).toEqual({ providers: {}, models: [] })
})

test("unknown provider reference is rejected", () => {
  const toml = `
[providers.default]
base_url = "https://api.example.test/v1"

[[models]]
id = "some/model"
task = "chat"
provider = "nope"
`
  expect(() => parse(toml)).toThrow("Unknown provider")
})

test("model without provider requires providers.default", () => {
  const toml = `
[providers.speaches]
base_url = "http://localhost:8000"

[[models]]
id = "some/model"
task = "chat"
`
  expect(() => parse(toml)).toThrow("[providers.default] is missing")
})

test("unknown task is rejected", () => {
  const toml = `
[providers.default]
base_url = "https://api.example.test/v1"

[[models]]
id = "some/model"
task = "juggling"
`
  expect(() => parse(toml)).toThrow()
})
