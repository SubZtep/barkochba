import { expect, test } from "bun:test"
import { PersonasFileSchema } from "../../schemas/personas"

test("persona without optional fields still validates", () => {
  const parsed = PersonasFileSchema.parse({
    personas: [{ id: "default", label: "Helpful assistant" }]
  })
  expect(parsed.personas[0]).toEqual({
    id: "default",
    label: "Helpful assistant"
  })
})

test("persona model and sampling params round-trip", () => {
  const parsed = PersonasFileSchema.parse({
    personas: [
      {
        id: "barkochba",
        label: "Barkochba guesser",
        model: "accounts/fireworks/models/kimi-k2p6",
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 512,
        frequency_penalty: 0.5,
        presence_penalty: -0.5,
        seed: 42
      }
    ]
  })
  expect(parsed.personas[0]).toEqual({
    id: "barkochba",
    label: "Barkochba guesser",
    model: "accounts/fireworks/models/kimi-k2p6",
    temperature: 0.7,
    top_p: 0.9,
    max_tokens: 512,
    frequency_penalty: 0.5,
    presence_penalty: -0.5,
    seed: 42
  })
})

test("temperature out of range is rejected", () => {
  expect(() =>
    PersonasFileSchema.parse({
      personas: [{ id: "x", label: "X", temperature: 2.5 }]
    })
  ).toThrow()
})

test("top_p out of range is rejected", () => {
  expect(() =>
    PersonasFileSchema.parse({
      personas: [{ id: "x", label: "X", top_p: 1.5 }]
    })
  ).toThrow()
})

test("max_tokens must be a positive integer", () => {
  expect(() =>
    PersonasFileSchema.parse({
      personas: [{ id: "x", label: "X", max_tokens: -1 }]
    })
  ).toThrow()
  expect(() =>
    PersonasFileSchema.parse({
      personas: [{ id: "x", label: "X", max_tokens: 1.5 }]
    })
  ).toThrow()
})

test("frequency_penalty and presence_penalty are bounded to [-2, 2]", () => {
  expect(() =>
    PersonasFileSchema.parse({
      personas: [{ id: "x", label: "X", frequency_penalty: 3 }]
    })
  ).toThrow()
  expect(() =>
    PersonasFileSchema.parse({
      personas: [{ id: "x", label: "X", presence_penalty: -3 }]
    })
  ).toThrow()
})
