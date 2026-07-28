import * as z from "zod"

export const DatasetFieldSchema = z.object({
  name: z.string().min(1),
  prompt: z.string().min(1),
  accepted: z.array(z.string().min(1)).optional()
})

// One file per topic under ~/.config/kaja/datasets/ (filename minus
// extension = topic id). revalidateAfterDays is optional: when set, a fully
// answered version becomes eligible for a fresh version once that many days
// have passed since it was completed; when unset, a completed version never
// expires.
export const DatasetSchema = z.object({
  label: z.string().min(1),
  fields: z.array(DatasetFieldSchema).min(1),
  revalidateAfterDays: z.number().int().positive().optional()
})

export type DatasetField = z.infer<typeof DatasetFieldSchema>
export type Dataset = z.infer<typeof DatasetSchema>

/** Normalizes an answer for case/whitespace-insensitive comparison against `accepted` values. */
export function normalizeAnswer(value: string): string {
  return value.trim().toLowerCase()
}
