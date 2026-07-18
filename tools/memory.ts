import { tool } from "../lib/agents"
import { loadMemory, saveMemory } from "../lib/memory-store"
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
  name: "remember_note",
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
 * Searches stored notes by keyword, ranked by importance.
 *
 * @param args.query - Search terms, tokenized and matched against each note's content, tags, and key.
 * @param args.limit - Max notes to return (default 5).
 * @returns The top-matching notes as "key: content" lines, or a no-match message.
 */
export const recallMemoryTool = tool<{ query: string; limit?: number }>({
  name: "recall_memory",
  description:
    "Search stored notes by keyword. Returns the best-matching notes, " +
    "ranked by relevance and importance.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search terms" },
      limit: {
        type: "number",
        description: "Max notes to return (default 5)"
      }
    },
    required: ["query"]
  },
  execute: async (args) => {
    const store = await loadMemory()
    const tokens = args.query.toLowerCase().split(/\s+/).filter(Boolean)

    const scored = Object.entries(store)
      .map(([key, note]) => {
        const haystack =
          `${note.content} ${note.tags.join(" ")} ${key}`.toLowerCase()
        const hits = tokens.reduce(
          (count, tok) => count + (haystack.includes(tok) ? 1 : 0),
          0
        )
        const score = hits * IMPORTANCE_WEIGHT[note.importance]
        return { key, note, score }
      })
      .filter((entry) => tokens.length === 0 || entry.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        return b.note.createdAt.localeCompare(a.note.createdAt)
      })
      .slice(0, args.limit ?? 5)

    if (scored.length === 0) return "(no matching notes)"

    const now = new Date().toISOString()
    for (const { key, note } of scored) {
      store[key] = { ...note, lastUsedAt: now, useCount: note.useCount + 1 }
    }
    await saveMemory(store)

    return scored.map(({ key, note }) => `${key}: ${note.content}`).join("\n")
  }
})

/**
 * Deletes one note by exact key.
 *
 * @param args.key - The note's key.
 */
export const forgetNoteTool = tool<{ key: string }>({
  name: "forget_note",
  description: "Delete a stored note by its exact key.",
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", description: "The note's key" }
    },
    required: ["key"]
  },
  execute: async (args) => {
    const store = await loadMemory()
    if (!(args.key in store)) return "(no note with that key)"
    delete store[args.key]
    await saveMemory(store)
    return `Forgot "${args.key}".`
  }
})

/**
 * Lists every stored note's key, importance, and sticky flag, for auditing what's remembered.
 */
export const listNotesTool = tool<Record<string, never>>({
  name: "list_notes",
  description:
    "List every stored note's key, importance, and sticky flag — use to " +
    "audit what's currently remembered.",
  parameters: {
    type: "object",
    properties: {},
    required: []
  },
  execute: async () => {
    const store = await loadMemory()
    const entries = Object.entries(store)
    if (entries.length === 0) return "(no notes stored)"
    return entries
      .map(
        ([key, note]) =>
          `${note.sticky ? "*" : " "} [${note.importance}] ${key}`
      )
      .join("\n")
  }
})
