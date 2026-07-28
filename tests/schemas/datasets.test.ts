import { expect, test } from "bun:test"
import { DatasetSchema, normalizeAnswer } from "../../schemas/datasets"

test("valid dataset parses with optional fields defaulted to undefined", () => {
  const dataset = DatasetSchema.parse({
    label: "Onboarding",
    fields: [{ name: "favorite_color", prompt: "What's your favorite color?" }]
  })
  expect(dataset.label).toBe("Onboarding")
  expect(dataset.fields).toHaveLength(1)
  expect(dataset.fields[0]!.accepted).toBeUndefined()
  expect(dataset.revalidateAfterDays).toBeUndefined()
})

test("valid dataset with accepted values and revalidateAfterDays parses", () => {
  const dataset = DatasetSchema.parse({
    label: "Onboarding",
    revalidateAfterDays: 365,
    fields: [
      {
        name: "notification_pref",
        prompt: "How do you want to be notified?",
        accepted: ["email", "push", "none"]
      }
    ]
  })
  expect(dataset.fields[0]!.accepted).toEqual(["email", "push", "none"])
  expect(dataset.revalidateAfterDays).toBe(365)
})

test("rejects a dataset with no fields", () => {
  expect(() => DatasetSchema.parse({ label: "Empty", fields: [] })).toThrow()
})

test("rejects a dataset missing label", () => {
  expect(() =>
    DatasetSchema.parse({
      fields: [{ name: "x", prompt: "y" }]
    })
  ).toThrow()
})

test("rejects a field missing prompt", () => {
  expect(() =>
    DatasetSchema.parse({
      label: "Bad",
      fields: [{ name: "x" }]
    })
  ).toThrow()
})

test("normalizeAnswer trims and lowercases", () => {
  expect(normalizeAnswer("  Email ")).toBe("email")
})
