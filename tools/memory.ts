import { REMEMBER_NOTE_TOOL, tool } from "../lib/agents"
import {
  forgetNotes,
  loadMemory,
  noteHeader,
  saveMemory
} from "../lib/memory-store"
import type { MemoryImportance } from "../schemas/memory"

const IMPORTANCE_WEIGHT: Record<MemoryImportance, number> = {
  low: 1,
  medium: 2,
  high: 3
}

/**
 * Writes or updates a durable fact, keyed for idempotent upserts.
 *
 * @param args.key - Stable identifier, e.g. "user:communication-style". Calling again with the same key overwrites in place instead of duplicating.
 * @param args.content - The fact itself.
 * @param args.importance - How much this should weigh in recall ranking.
 * @param args.tags - Optional labels to help future recall_memory queries match.
 * @param args.sticky - When true, this note is injected into every future session's system prompt instead of waiting for a recall_memory query.
 */
export const rememberNoteTool = tool<{
  key: string
  content: string
  importance: MemoryImportance
  tags?: string[]
  sticky?: boolean
}>({
  name: REMEMBER_NOTE_TOOL,
  description:
    "Write or update a durable fact for future sessions. Upserts by key " +
    "(calling again with the same key overwrites, it doesn't duplicate). " +
    "Write proactively whenever you learn something durable about the " +
    "user or project — don't ask permission first.",
  parameters: {
    type: "object",
    properties: {
      key: {
        type: "string",
        description:
          "Stable identifier for this fact, e.g. 'user:communication-style'"
      },
      content: { type: "string", description: "The fact itself" },
      importance: {
        type: "string",
        enum: ["low", "medium", "high"],
        description: "How much this should weigh in recall ranking"
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional labels to help future recall_memory queries match"
      },
      sticky: {
        type: "boolean",
        description:
          "When true, this note is shown at the start of every future session instead of waiting for a recall_memory query"
      }
    },
    required: ["key", "content", "importance"]
  },
  execute: async (args) => {
    const store = await loadMemory()
    const now = new Date().toISOString()
    const existing = store[args.key]
    store[args.key] = {
      content: args.content,
      importance: args.importance,
      tags: args.tags ?? [],
      sticky: args.sticky ?? false,
      createdAt: existing?.createdAt ?? now,
      lastUsedAt: now,
      useCount: existing?.useCount ?? 0
    }
    await saveMemory(store)
    return `Remembered "${args.key}".`
  }
})

/**
 * Searches stored notes by keyword, ranked by importance, with optional
 * metadata filters.
 *
 * @param args.query - Search terms, tokenized and matched against each note's content, tags, and key. May be empty when a filter is given.
 * @param args.limit - Max notes to return (default 5).
 * @param args.tags - Only notes carrying at least one of these tags.
 * @param args.stickyOnly - Only sticky notes.
 * @param args.minImportance - Only notes at or above this importance.
 * @returns The top-matching notes with their metadata header, or a no-match message.
 */
export const recallMemoryTool = tool<{
  query: string
  limit?: number
  tags?: string[]
  stickyOnly?: boolean
  minImportance?: MemoryImportance
}>({
  name: "recall_memory",
  description:
    "Search stored notes by keyword, ranked by relevance and importance. " +
    "Optional filters: tags (any-of), stickyOnly, minImportance. An empty " +
    "query with a filter returns the whole filtered set.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search terms; may be empty when a filter is given"
      },
      limit: {
        type: "number",
        description:
          "Max notes to return (default 5 for keyword queries; an empty query is uncapped unless this is set)"
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Only notes carrying at least one of these tags"
      },
      stickyOnly: {
        type: "boolean",
        description: "Only sticky notes"
      },
      minImportance: {
        type: "string",
        enum: ["low", "medium", "high"],
        description: "Only notes at or above this importance"
      }
    },
    required: ["query"]
  },
  execute: async (args) => {
    const store = await loadMemory()
    const tokens = args.query.toLowerCase().split(/\s+/).filter(Boolean)

    const scored = Object.entries(store)
      .filter(([, note]) => {
        if (args.stickyOnly && !note.sticky) return false
        if (
          args.minImportance &&
          IMPORTANCE_WEIGHT[note.importance] <
            IMPORTANCE_WEIGHT[args.minImportance]
        )
          return false
        if (
          args.tags &&
          args.tags.length > 0 &&
          !note.tags.some((tag) => args.tags!.includes(tag))
        )
          return false
        return true
      })
      .map(([key, note]) => {
        const haystack =
          `${note.content} ${note.tags.join(" ")} ${key}`.toLowerCase()
        // An empty query means "everything the filters allow", ranked purely
        // by importance — one synthetic hit gives each note its weight.
        const hits =
          tokens.length === 0
            ? 1
            : tokens.reduce(
                (count, tok) => count + (haystack.includes(tok) ? 1 : 0),
                0
              )
        const score = hits * IMPORTANCE_WEIGHT[note.importance]
        return { key, note, score }
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        return b.note.createdAt.localeCompare(a.note.createdAt)
      })
      // An empty query is the audit/bulk view: honor "returns the whole
      // filtered set" — only an explicit limit truncates it.
      .slice(
        0,
        args.limit ?? (tokens.length === 0 ? Number.POSITIVE_INFINITY : 5)
      )

    if (scored.length === 0) return "(no matching notes)"

    const result = scored
      .map(({ key, note }) => `${noteHeader(key, note)}: ${note.content}`)
      .join("\n")

    const now = new Date().toISOString()
    for (const { key, note } of scored) {
      store[key] = { ...note, lastUsedAt: now, useCount: note.useCount + 1 }
    }
    await saveMemory(store)

    return result
  }
})

/**
 * Deletes notes by exact key, by tag, or by key glob pattern.
 *
 * @param args.key - Exact key of one note to delete.
 * @param args.tag - Delete every note carrying this tag.
 * @param args.pattern - Delete every note whose key matches this glob, e.g. "test:*".
 */
export const forgetNoteTool = tool<{
  key?: string
  tag?: string
  pattern?: string
}>({
  name: "forget_note",
  description:
    "Delete stored notes. Provide exactly one selector: key (exact), tag " +
    "(every note carrying it), or pattern (key glob like 'test:*'). " +
    "Returns the forgotten keys.",
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", description: "Exact key of one note to delete" },
      tag: {
        type: "string",
        description: "Delete every note carrying this tag"
      },
      pattern: {
        type: "string",
        description:
          "Delete every note whose key matches this glob, e.g. 'test:*'"
      }
    },
    required: []
  },
  execute: async (args) => {
    const selectors = [args.key, args.tag, args.pattern].filter(
      (s) => s !== undefined
    )
    if (selectors.length !== 1)
      return "Provide exactly one of: key, tag, pattern."

    const store = await loadMemory()
    const victims = forgetNotes(store, args)
    if (victims.length === 0)
      return args.key !== undefined
        ? "(no note with that key)"
        : "(no matching notes)"

    await saveMemory(store)
    return `Forgot: ${victims.join(", ")}`
  }
})

/**
 * Lists every stored note with its metadata, for auditing what's remembered.
 *
 * @param args.full - When true, include each note's content below its header.
 */
export const listNotesTool = tool<{ full?: boolean }>({
  name: "list_notes",
  description:
    "List every stored note's key, importance, sticky flag, tags, and " +
    "last-used date — use to audit what's currently remembered. Pass " +
    "full: true to include each note's content.",
  parameters: {
    type: "object",
    properties: {
      full: {
        type: "boolean",
        description: "Include each note's content below its header"
      }
    },
    required: []
  },
  execute: async (args) => {
    const store = await loadMemory()
    const entries = Object.entries(store)
    if (entries.length === 0) return "(no notes stored)"
    return entries
      .map(([key, note]) =>
        args.full
          ? `${noteHeader(key, note)}\n  ${note.content}`
          : noteHeader(key, note)
      )
      .join("\n")
  }
})
