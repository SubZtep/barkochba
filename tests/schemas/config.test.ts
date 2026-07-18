import { expect, test } from "bun:test"
import { KajaConfigSchema } from "../../schemas/config"

const base = {
  braveApiKey: "key",
  openaiApiBaseUrl: "https://api.example.test/v1",
  openaiApiKey: "key",
  openaiApiModel: "some-model",
  geoServiceUrl: "https://geo.example.test",
  geoServiceApiKey: "123e4567-e89b-12d3-a456-426614174000"
}

test("config without settings still validates", () => {
  const parsed = KajaConfigSchema.parse(base)
  expect(parsed.settings).toBeUndefined()
})

test("config with settings round-trips", () => {
  const parsed = KajaConfigSchema.parse({
    ...base,
    settings: { thinking: false, sounds: true }
  })
  expect(parsed.settings).toEqual({ thinking: false, sounds: true })
})

test("partial settings are allowed", () => {
  const parsed = KajaConfigSchema.parse({
    ...base,
    settings: { sounds: false }
  })
  expect(parsed.settings).toEqual({ sounds: false })
})

test("settings language accepts en and hu only", () => {
  const parsed = KajaConfigSchema.parse({
    ...base,
    settings: { language: "hu" }
  })
  expect(parsed.settings).toEqual({ language: "hu" })
  expect(() =>
    KajaConfigSchema.parse({ ...base, settings: { language: "de" } })
  ).toThrow()
})
