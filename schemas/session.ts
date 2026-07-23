import * as z from "zod"

/**
 * A conversation persisted in the memory database. Two shapes are stored
 * side by side: `session` is the agent's replayable OpenAI-format history
 * (lib/agents.ts Session — messages kept opaque, they carry non-standard
 * fields like reasoning_content), and `events` is the rendered timeline
 * (hooks/use-agent.ts TimelineEvent[]) so a resumed session repaints
 * exactly as it looked, without reconstructing it from the messages.
 */
export const PersistedSessionSchema = z.object({
  id: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Persona.id at last save. */
  persona: z.string(),
  /** Model id at last save. */
  model: z.string(),
  /** First user prompt's first line, at most 60 chars. */
  title: z.string(),
  session: z.looseObject({
    messages: z.array(z.unknown()),
    pendingAskUserId: z.string().optional(),
    pendingRunCommandId: z.string().optional()
  }),
  events: z.array(z.looseObject({ type: z.string() }))
})

/** List-view projection: everything but the two payload blobs. */
export const SessionMetaSchema = PersistedSessionSchema.omit({
  session: true,
  events: true
})

export type PersistedSession = z.infer<typeof PersistedSessionSchema>
export type SessionMeta = z.infer<typeof SessionMetaSchema>
