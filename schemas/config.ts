import * as z from "zod"

export const KajaSettingsSchema = z.object({
  thinking: z.boolean().optional(),
  sounds: z.boolean().optional(),
  voice: z.boolean().optional(),
  language: z.enum(["en", "hu"]).optional(),
  // Id of the last-selected persona (see schemas/personas.ts), so the app
  // reopens with it instead of always defaulting to the first one.
  persona: z.string().min(1).optional()
})

// Feature groups: each is a self-contained block of config for one feature.
// llm is mandatory (this is a chat app; no meaningful mode without it).
// stt/tts/location/webSearch are optional — when a group is absent, that
// feature is simply unavailable rather than crashing the app. Fields within
// an optional group still validate as a whole (no half-filled groups),
// except stt/tts fields which stay optional since they have code-side
// fallback defaults.
export const KajaLlmSchema = z.object({
  baseUrl: z.url(),
  apiKey: z.string().min(1),
  model: z.string().min(1)
})

export const KajaSttSchema = z.object({
  speachesUrl: z.url().optional(),
  model: z.string().min(1).optional(),
  language: z.string().min(1).optional()
})

export const KajaTtsSchema = z.object({
  speachesUrl: z.url().optional(),
  model: z.string().min(1).optional(),
  voice: z.string().min(1).optional()
})

export const KajaLocationSchema = z.object({
  serviceUrl: z.url(),
  apiKey: z.string().min(1)
})

export const KajaWebSearchSchema = z.object({
  apiKey: z.string().min(1)
})

// All fields optional: falls back to llm.baseUrl/llm.apiKey and the built-in
// default model (see tools/rerank.ts) when unset.
export const KajaRerankSchema = z.object({
  baseUrl: z.url().optional(),
  apiKey: z.string().min(1).optional(),
  model: z.string().min(1).optional()
})

// All fields optional: falls back to llm.baseUrl/llm.apiKey and the
// built-in default model when unset (see lib/embeddings.ts).
export const KajaEmbeddingSchema = z.object({
  baseUrl: z.url().optional(),
  apiKey: z.string().min(1).optional(),
  model: z.string().min(1).optional()
})

export const KajaMemorySchema = z.object({
  // Absolute path to the SQLite database file. Omit to use the default XDG
  // data location (see lib/memory-store.ts).
  dbPath: z.string().min(1).optional()
})

export const KajaBrowserSchema = z.object({
  headless: z.boolean().optional()
})

// Presence of this group enables the Chrome DevTools MCP connection, which
// attaches to the user's already-running Chrome (via --autoConnect) instead
// of spawning an isolated browser, so the agent can see the page currently
// open.
export const KajaChromeSchema = z.object({})

// baseUrl/apiKey are mandatory (xAI's Images API, not the main llm
// provider); model is optional — the tool only sends `model` to the API
// when it's set here, otherwise the provider's own default is used.
export const KajaImageGenSchema = z.object({
  baseUrl: z.url(),
  apiKey: z.string().min(1),
  model: z.string().min(1).optional()
})

export const KajaConfigSchema = z.object({
  llm: KajaLlmSchema,
  stt: KajaSttSchema.optional(),
  tts: KajaTtsSchema.optional(),
  location: KajaLocationSchema.optional(),
  webSearch: KajaWebSearchSchema.optional(),
  rerank: KajaRerankSchema.optional(),
  embedding: KajaEmbeddingSchema.optional(),
  memory: KajaMemorySchema.optional(),
  browser: KajaBrowserSchema.optional(),
  chrome: KajaChromeSchema.optional(),
  imageGen: KajaImageGenSchema.optional(),
  // In-app preferences (slash menu); optional so existing configs stay valid.
  settings: KajaSettingsSchema.optional()
})

export type KajaConfig = z.infer<typeof KajaConfigSchema>
export type KajaSettings = z.infer<typeof KajaSettingsSchema>
export type KajaLlm = z.infer<typeof KajaLlmSchema>
export type KajaStt = z.infer<typeof KajaSttSchema>
export type KajaTts = z.infer<typeof KajaTtsSchema>
export type KajaLocation = z.infer<typeof KajaLocationSchema>
export type KajaWebSearch = z.infer<typeof KajaWebSearchSchema>
export type KajaRerank = z.infer<typeof KajaRerankSchema>
export type KajaEmbedding = z.infer<typeof KajaEmbeddingSchema>
export type KajaMemory = z.infer<typeof KajaMemorySchema>
export type KajaBrowser = z.infer<typeof KajaBrowserSchema>
export type KajaChrome = z.infer<typeof KajaChromeSchema>
export type KajaImageGen = z.infer<typeof KajaImageGenSchema>
