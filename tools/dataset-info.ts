import { DATASET_INFO_TOOL, LOCAL_OWNER_CTX, tool } from "../lib/agents"
import { loadDataset, loadDatasets } from "../lib/datasets"
import {
  latestDatasetVersion,
  loadDatasetAnswers,
  loadDatasetVersionCompletedAt,
  markDatasetVersionComplete,
  saveDatasetAnswer
} from "../lib/memory-store"
import { normalizeAnswer } from "../schemas/datasets"

type Args =
  | { action: "list_datasets" }
  | { action: "get_status"; dataset: string }
  | { action: "answer"; dataset: string; field: string; value: string }
  | { action: "start_new_version"; dataset: string }

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Resolves the version of `topic` that's currently active for `owner`:
 * the latest version if it's still incomplete or not yet stale, otherwise a
 * fresh next version. Returns the version number, whether it was just
 * freshly started, and its already-recorded answers (empty for a fresh
 * version).
 */
async function resolveActiveVersion(
  topic: string,
  owner: string | null,
  revalidateAfterDays: number | undefined,
  totalFields: number
) {
  const latest = await latestDatasetVersion(topic, owner)
  if (latest === 0) return { version: 1, justStarted: false, answers: [] }

  const answers = await loadDatasetAnswers(topic, owner, latest)
  const complete = answers.length >= totalFields
  if (!complete) return { version: latest, justStarted: false, answers }

  const completedAt = await loadDatasetVersionCompletedAt(topic, owner, latest)
  const stale =
    completedAt !== undefined &&
    revalidateAfterDays !== undefined &&
    Date.now() - new Date(completedAt).getTime() >
      revalidateAfterDays * MS_PER_DAY

  if (!stale) return { version: latest, justStarted: false, answers }
  return { version: latest + 1, justStarted: true, answers: [] }
}

function formatStatus(
  dataset: Awaited<ReturnType<typeof loadDataset>>,
  version: number,
  answers: { field: string; value: string }[],
  justStarted: boolean
) {
  if (!dataset) return "Unknown dataset."
  const answeredByField = new Map(answers.map((a) => [a.field, a.value]))
  const answered = dataset.fields.filter((f) => answeredByField.has(f.name))
  const unanswered = dataset.fields.filter((f) => !answeredByField.has(f.name))

  const lines = [
    justStarted
      ? `Previous version was complete and stale — started fresh version ${version}.`
      : `Version ${version}.`
  ]

  if (answered.length > 0) {
    lines.push(
      "Already answered:",
      ...answered.map((f) => `- ${f.name}: ${answeredByField.get(f.name)}`)
    )
  }

  if (unanswered.length === 0) {
    lines.push(
      dataset.revalidateAfterDays
        ? `All fields answered — complete, will revalidate after ${dataset.revalidateAfterDays} days.`
        : "All fields answered — complete, never expires."
    )
  } else {
    lines.push(
      "Still need:",
      ...unanswered.map((f) =>
        f.accepted
          ? `- ${f.name}: "${f.prompt}" (accepted answers: ${f.accepted.join(", ")})`
          : `- ${f.name}: "${f.prompt}"`
      )
    )
  }

  return lines.join("\n")
}

/**
 * Collects a dataset's fields from a user conversationally, one at a time,
 * persisting answers across sessions and supporting versioned re-collection.
 * Datasets are topic-agnostic config files under ~/.config/kaja/datasets/
 * (see lib/datasets.ts) — each defines a label, a list of fields (a name, a
 * prompt to ask, and optionally a fixed list of accepted answers), and an
 * optional revalidateAfterDays that controls when a completed version
 * becomes eligible for a fresh one.
 */
export const datasetInfoTool = tool<Args>({
  name: DATASET_INFO_TOOL,
  description:
    "Collect a dataset's fields from the user by asking about them one at " +
    "a time, persisting answers so they survive across sessions. Actions: " +
    "'list_datasets' lists available datasets — call this first if you " +
    "don't know which dataset id to use; 'get_status' loads the current " +
    "version's progress for a dataset, showing which fields are already " +
    "answered and which remain (with each remaining field's prompt and, if " +
    "applicable, its fixed list of accepted answers) — always call this " +
    "before asking anything, and again after each 'answer' to know what's " +
    "next; if the dataset was already fully answered in a prior session and " +
    "has since become eligible for revalidation, 'get_status' transparently " +
    "starts a new version and tells you so — treat every field as " +
    "unanswered again in that case; 'answer' records the user's reply to " +
    "one field — if the field has a fixed list of accepted answers, the " +
    "value must match one of them (case-insensitive) or it's rejected " +
    "without being saved, so tell the user the accepted options and ask " +
    "again; 'start_new_version' explicitly starts a fresh version even " +
    "though the current one isn't stale yet — only call this if the user " +
    "asks to redo their answers. Ask about each unanswered field " +
    "conversationally, phrasing its prompt naturally rather than reading it " +
    "verbatim, and ask one at a time rather than dumping the whole list on " +
    "the user.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["list_datasets", "get_status", "answer", "start_new_version"],
        description: "Which action to perform"
      },
      dataset: {
        type: "string",
        description:
          "Required for every action except 'list_datasets'. Exact dataset id from 'list_datasets'."
      },
      field: {
        type: "string",
        description:
          "Required for 'answer'. Exact field name from 'get_status'."
      },
      value: {
        type: "string",
        description:
          "Required for 'answer'. The user's answer. Must match one of the " +
          "field's accepted values (case-insensitive) if it has any."
      }
    },
    required: ["action"]
  },
  execute: async (args, ctx = LOCAL_OWNER_CTX) => {
    if (args.action === "list_datasets") {
      const datasets = await loadDatasets()
      if (datasets.size === 0) return "(no datasets configured)"
      return [...datasets.entries()]
        .map(
          ([topic, dataset]) =>
            `${topic}: ${dataset.label} (${dataset.fields.length} fields)`
        )
        .join("\n")
    }

    switch (args.action) {
      case "get_status": {
        const dataset = await loadDataset(args.dataset)
        if (!dataset) return `Unknown dataset: ${args.dataset}`
        const { version, justStarted, answers } = await resolveActiveVersion(
          args.dataset,
          ctx.owner,
          dataset.revalidateAfterDays,
          dataset.fields.length
        )
        return formatStatus(dataset, version, answers, justStarted)
      }

      case "answer": {
        if (!args.field) return "Error: 'field' is required for answer."
        if (args.value === undefined)
          return "Error: 'value' is required for answer."
        const dataset = await loadDataset(args.dataset)
        if (!dataset) return `Unknown dataset: ${args.dataset}`
        const field = dataset.fields.find((f) => f.name === args.field)
        if (!field) return `Unknown field: ${args.field}`

        if (field.accepted) {
          const normalized = normalizeAnswer(args.value)
          const match = field.accepted.find(
            (accepted) => normalizeAnswer(accepted) === normalized
          )
          if (!match)
            return (
              `"${args.value}" isn't an accepted answer for ${field.name}. ` +
              `Accepted answers: ${field.accepted.join(", ")}.`
            )
        }

        const { version, answers } = await resolveActiveVersion(
          args.dataset,
          ctx.owner,
          dataset.revalidateAfterDays,
          dataset.fields.length
        )
        await saveDatasetAnswer(
          args.dataset,
          ctx.owner,
          version,
          field.name,
          args.value
        )

        const updatedAnswers = [
          ...answers.filter((a) => a.field !== field.name),
          { field: field.name, value: args.value, answeredAt: "" }
        ]
        if (updatedAnswers.length >= dataset.fields.length)
          await markDatasetVersionComplete(args.dataset, ctx.owner, version)

        return formatStatus(dataset, version, updatedAnswers, false)
      }

      case "start_new_version": {
        const dataset = await loadDataset(args.dataset)
        if (!dataset) return `Unknown dataset: ${args.dataset}`
        const latest = await latestDatasetVersion(args.dataset, ctx.owner)
        const version = latest + 1
        return formatStatus(dataset, version, [], true)
      }

      default:
        return `Unknown action: ${(args as { action: string }).action}`
    }
  }
})
