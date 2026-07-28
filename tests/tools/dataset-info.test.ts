import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Fresh directories (not fixed names) so re-running the suite never
// accumulates rows/config from a previous run's on-disk state.
const dataDir = mkdtempSync(join(tmpdir(), "kaja-test-xdg-data-dataset-info-"))
const configDir = mkdtempSync(
  join(tmpdir(), "kaja-test-xdg-config-dataset-info-")
)
process.env.XDG_DATA_HOME = dataDir
process.env.XDG_CONFIG_HOME = configDir

const configKajaDir = join(configDir, "kaja")
mkdirSync(configKajaDir, { recursive: true })
writeFileSync(
  join(configKajaDir, "config.json"),
  JSON.stringify({
    llm: { baseUrl: "http://localhost", apiKey: "x", model: "x" }
  })
)

const datasetsDir = join(configKajaDir, "datasets")
mkdirSync(datasetsDir, { recursive: true })
writeFileSync(
  join(datasetsDir, "onboarding.json"),
  JSON.stringify({
    label: "Onboarding",
    revalidateAfterDays: 30,
    fields: [
      { name: "favorite_color", prompt: "What's your favorite color?" },
      {
        name: "notification_pref",
        prompt: "How do you want to be notified?",
        accepted: ["email", "push", "none"]
      }
    ]
  })
)
writeFileSync(
  join(datasetsDir, "never_expires.json"),
  JSON.stringify({
    label: "Never Expires",
    fields: [{ name: "name", prompt: "What's your name?" }]
  })
)

const { saveMemory } = await import("../../lib/memory-store")
const { datasetInfoTool } = await import("../../tools/dataset-info")

afterEach(async () => {
  await saveMemory({})
})

test("list_datasets lists available datasets with field counts", async () => {
  const result = await datasetInfoTool.execute({ action: "list_datasets" })
  expect(result).toContain("onboarding: Onboarding (2 fields)")
  expect(result).toContain("never_expires: Never Expires (1 fields)")
})

test("get_status on an unknown dataset returns an error", async () => {
  const result = await datasetInfoTool.execute({
    action: "get_status",
    dataset: "nope"
  })
  expect(result).toBe("Unknown dataset: nope")
})

test("get_status on a fresh dataset lists all fields unanswered", async () => {
  const result = await datasetInfoTool.execute({
    action: "get_status",
    dataset: "onboarding"
  })
  expect(result).toContain("Version 1.")
  expect(result).toContain("favorite_color")
  expect(result).toContain("notification_pref")
  expect(result).toContain("accepted answers: email, push, none")
  expect(result).not.toContain("Already answered")
})

test("answer rejects a value not in the field's accepted list, without persisting", async () => {
  const owner = "test:reject"
  const result = await datasetInfoTool.execute(
    {
      action: "answer",
      dataset: "onboarding",
      field: "notification_pref",
      value: "carrier pigeon"
    },
    { owner }
  )
  expect(result).toContain("isn't an accepted answer")
  expect(result).toContain("email, push, none")

  const status = await datasetInfoTool.execute(
    { action: "get_status", dataset: "onboarding" },
    { owner }
  )
  expect(status).not.toContain("Already answered")
})

test("answer accepts a case-insensitive match against the accepted list", async () => {
  const result = await datasetInfoTool.execute(
    {
      action: "answer",
      dataset: "onboarding",
      field: "notification_pref",
      value: "EMAIL"
    },
    { owner: "test:case-insensitive" }
  )
  expect(result).toContain("Already answered")
  expect(result).toContain("notification_pref: EMAIL")
})

test("answer on an unknown field returns an error", async () => {
  const result = await datasetInfoTool.execute(
    { action: "answer", dataset: "onboarding", field: "nope", value: "x" },
    { owner: "test:unknown-field" }
  )
  expect(result).toBe("Unknown field: nope")
})

test("answering every field marks the version complete", async () => {
  const owner = "test:complete"
  await datasetInfoTool.execute(
    {
      action: "answer",
      dataset: "never_expires",
      field: "name",
      value: "Andras"
    },
    { owner }
  )
  const status = await datasetInfoTool.execute(
    { action: "get_status", dataset: "never_expires" },
    { owner }
  )
  expect(status).toContain("complete, never expires")
})

test("a complete, non-stale version is resumed as complete rather than restarted", async () => {
  const owner = "test:resume-complete"
  await datasetInfoTool.execute(
    {
      action: "answer",
      dataset: "never_expires",
      field: "name",
      value: "Andras"
    },
    { owner }
  )
  const status = await datasetInfoTool.execute(
    { action: "get_status", dataset: "never_expires" },
    { owner }
  )
  expect(status).toContain("Version 1.")
  expect(status).toContain("complete, never expires")
  expect(status).not.toContain("started fresh version")
})

test("start_new_version explicitly bumps the version without waiting for staleness", async () => {
  const owner = "test:new-version"
  await datasetInfoTool.execute(
    {
      action: "answer",
      dataset: "never_expires",
      field: "name",
      value: "Andras"
    },
    { owner }
  )
  const result = await datasetInfoTool.execute(
    { action: "start_new_version", dataset: "never_expires" },
    { owner }
  )
  expect(result).toContain("started fresh version 2")
  const status = await datasetInfoTool.execute(
    { action: "get_status", dataset: "never_expires" },
    { owner }
  )
  // get_status resolves the latest version independently of start_new_version's
  // (not-yet-persisted) bump — since no answer was saved under version 2 yet,
  // version 1 (complete, never expiring) is still what's active.
  expect(status).toContain("complete, never expires")
})

test("owner scoping: two owners answering the same dataset don't see each other's progress", async () => {
  await datasetInfoTool.execute(
    {
      action: "answer",
      dataset: "onboarding",
      field: "favorite_color",
      value: "blue"
    },
    { owner: "telegram:1" }
  )
  const statusForOwner1 = await datasetInfoTool.execute(
    { action: "get_status", dataset: "onboarding" },
    { owner: "telegram:1" }
  )
  const statusForOwner2 = await datasetInfoTool.execute(
    { action: "get_status", dataset: "onboarding" },
    { owner: "telegram:2" }
  )
  expect(statusForOwner1).toContain("favorite_color: blue")
  expect(statusForOwner2).not.toContain("Already answered")
})
