import * as z from "zod"

export const MemoryImportanceSchema = z.enum(["low", "medium", "high"])

export const MemoryNoteSchema = z.object({
  content: z.string().min(1),
  importance: MemoryImportanceSchema,
  tags: z.array(z.string()).default([]),
  sticky: z.boolean().default(false),
  createdAt: z.string(),
  lastUsedAt: z.string(),
  useCount: z.number().int().nonnegative().default(0)
})

// Keyed by note key (e.g. "user:communication-style").
export const MemoryStoreSchema = z.record(z.string(), MemoryNoteSchema)

export type MemoryImportance = z.infer<typeof MemoryImportanceSchema>
export type MemoryNote = z.infer<typeof MemoryNoteSchema>
export type MemoryStore = z.infer<typeof MemoryStoreSchema>
