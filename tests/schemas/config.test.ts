import { expect, test } from "bun:test"
import { KajaConfigSchema } from "../../schemas/config"

const base = {
  llm: {
    baseUrl: "https://api.example.test/v1",
    apiKey: "key",
    model: "some-model"
  }
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

test("llm is required", () => {
  expect(() => KajaConfigSchema.parse({})).toThrow()
})

test("stt, tts, location, webSearch are independently optional", () => {
  const parsed = KajaConfigSchema.parse(base)
  expect(parsed.stt).toBeUndefined()
  expect(parsed.tts).toBeUndefined()
  expect(parsed.location).toBeUndefined()
  expect(parsed.webSearch).toBeUndefined()
})

test("stt group with only some optional fields validates", () => {
  const parsed = KajaConfigSchema.parse({
    ...base,
    stt: { model: "whisper-small" }
  })
  expect(parsed.stt).toEqual({ model: "whisper-small" })
})

test("tts group with only some optional fields validates", () => {
  const parsed = KajaConfigSchema.parse({
    ...base,
    tts: { voice: "af_heart" }
  })
  expect(parsed.tts).toEqual({ voice: "af_heart" })
})

test("location group requires both fields together", () => {
  const parsed = KajaConfigSchema.parse({
    ...base,
    location: { serviceUrl: "https://geo.example.test", apiKey: "key" }
  })
  expect(parsed.location).toEqual({
    serviceUrl: "https://geo.example.test",
    apiKey: "key"
  })
  expect(() =>
    KajaConfigSchema.parse({
      ...base,
      location: { serviceUrl: "https://geo.example.test" }
    })
  ).toThrow()
})

test("webSearch group requires apiKey", () => {
  const parsed = KajaConfigSchema.parse({
    ...base,
    webSearch: { apiKey: "key" }
  })
  expect(parsed.webSearch).toEqual({ apiKey: "key" })
  expect(() => KajaConfigSchema.parse({ ...base, webSearch: {} })).toThrow()
})
