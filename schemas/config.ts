import * as z from "zod"

export const KajaSettingsSchema = z.object({
  thinking: z.boolean().optional(),
  sounds: z.boolean().optional(),
  voice: z.boolean().optional(),
  language: z.enum(["en", "hu"]).optional()
})

// Voice (STT/TTS) server settings; optional with code-side defaults so
// existing configs stay valid and voice keeps working out of the box.
export const KajaVoiceSchema = z.object({
  speachesUrl: z.url().optional(),
  sttModel: z.string().min(1).optional(),
  sttLanguage: z.string().min(1).optional(),
  ttsModel: z.string().min(1).optional(),
  ttsVoice: z.string().min(1).optional()
})

export const KajaConfigSchema = z.object({
  braveApiKey: z.string().min(1),
  openaiApiBaseUrl: z.url(),
  openaiApiKey: z.string().min(1),
  openaiApiModel: z.string().min(1),
  geoServiceUrl: z.url(),
  geoServiceApiKey: z.uuid(),
  // In-app preferences (slash menu); optional so existing configs stay valid.
  settings: KajaSettingsSchema.optional(),
  voice: KajaVoiceSchema.optional()
})

export type KajaConfig = z.infer<typeof KajaConfigSchema>
export type KajaSettings = z.infer<typeof KajaSettingsSchema>
export type KajaVoice = z.infer<typeof KajaVoiceSchema>
