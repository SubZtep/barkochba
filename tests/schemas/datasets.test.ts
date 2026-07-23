import { expect, test } from "bun:test"
import { DatasetSchema } from "../../schemas/datasets"

test("valid dataset parses with optional fields defaulted to undefined", () => {
  const dataset = DatasetSchema.parse({
    label: "Movies to watch",
    entries: [{ name: "Alien", description: "A crew encounters a threat." }]
  })
  expect(dataset.label).toBe("Movies to watch")
  expect(dataset.entries).toHaveLength(1)
  expect(dataset.excludeNames).toBeUndefined()
  expect(dataset.excludeKeywords).toBeUndefined()
})

test("valid dataset with excludeNames/excludeKeywords parses", () => {
  const dataset = DatasetSchema.parse({
    label: "Movies to watch",
    excludeNames: ["Movie 43"],
    excludeKeywords: ["banned"],
    entries: [{ name: "Alien", description: "A crew encounters a threat." }]
  })
  expect(dataset.excludeNames).toEqual(["Movie 43"])
  expect(dataset.excludeKeywords).toEqual(["banned"])
})

test("rejects a dataset with no entries", () => {
  expect(() => DatasetSchema.parse({ label: "Empty", entries: [] })).toThrow()
})

test("rejects a dataset missing label", () => {
  expect(() =>
    DatasetSchema.parse({
      entries: [{ name: "x", description: "y" }]
    })
  ).toThrow()
})

test("rejects an entry missing description", () => {
  expect(() =>
    DatasetSchema.parse({
      label: "Bad",
      entries: [{ name: "x" }]
    })
  ).toThrow()
})
