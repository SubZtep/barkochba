import * as z from "zod"

/**
 * Optional chat completion sampling overrides. All fields are optional:
 * unset means "use the provider's own default sampling behavior". Shared
 * with lib/agents.ts's `Agent.sampling`, which sends these straight through
 * to the chat completion request.
 */
export const SamplingParamsSchema = z.object({
  /** Randomness of token selection, 0 (deterministic) to 2 (most random). */
  temperature: z.number().min(0).max(2).optional(),
  /** Nucleus sampling threshold: only tokens in the top `top_p` probability mass are considered. */
  top_p: z.number().min(0).max(1).optional(),
  /** Maximum number of tokens to generate in the completion. */
  max_tokens: z.number().int().positive().optional(),
  /** Penalizes tokens by how often they've already appeared, -2 to 2; positive values discourage repetition. */
  frequency_penalty: z.number().min(-2).max(2).optional(),
  /** Penalizes tokens that have appeared at all so far, -2 to 2; positive values encourage new topics. */
  presence_penalty: z.number().min(-2).max(2).optional(),
  /** Fixes the sampling seed for (best-effort) reproducible outputs across requests. */
  seed: z.number().int().optional()
})

// model is optional: unset means "use the app's default model". When set,
// it's validated against the resolved models list by loadPersonas() (see
// lib/personas.ts) — schemas here have no access to models.toml at parse
// time.
//
// A persona's id isn't part of this schema: it's the filename (minus
// extension) of its file under personas/, attached by loadPersonas() after
// parsing — same convention as schemas/datasets.ts's topic ids.
export const PersonaSchema = z
  .object({
    label: z.string().min(1),
    instructions: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    // Topic id (matches a schemas/datasets.ts config filename) this persona
    // is responsible for collecting via the dataset_info tool. Optional —
    // most personas don't collect a dataset.
    dataset: z.string().min(1).optional(),
    // One short clause describing when this persona fits (e.g. "the user
    // talks about mood, energy, or sleep"). Listed in the ## Personas
    // system-prompt roster so the model knows when to switch_persona to it.
    when: z.string().min(1).optional()
  })
  .extend(SamplingParamsSchema.shape)

export type Persona = z.infer<typeof PersonaSchema> & { id: string }
export type SamplingParams = z.infer<typeof SamplingParamsSchema>
