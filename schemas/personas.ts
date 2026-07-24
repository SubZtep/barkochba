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
const PersonaSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    instructions: z.string().min(1).optional(),
    model: z.string().min(1).optional()
  })
  .extend(SamplingParamsSchema.shape)

export const PersonasFileSchema = z.object({
  personas: z.array(PersonaSchema).default([])
})

export type KajaPersonasFile = z.infer<typeof PersonasFileSchema>
export type Persona = z.infer<typeof PersonaSchema>
export type SamplingParams = z.infer<typeof SamplingParamsSchema>
