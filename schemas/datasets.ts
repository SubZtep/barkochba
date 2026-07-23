import * as z from "zod"

export const DatasetEntrySchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1)
})

// One file per topic under ~/.config/kaja/datasets/ (filename minus
// extension = topic id). excludeNames/excludeKeywords are optional,
// per-dataset content filters for topics that need to keep certain entries
// out of the pool entirely — most topics won't need them.
export const DatasetSchema = z.object({
  label: z.string().min(1),
  entries: z.array(DatasetEntrySchema).min(1),
  excludeNames: z.array(z.string()).optional(),
  excludeKeywords: z.array(z.string()).optional()
})

export type DatasetEntry = z.infer<typeof DatasetEntrySchema>
export type Dataset = z.infer<typeof DatasetSchema>
