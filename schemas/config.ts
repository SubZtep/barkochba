import * as z from "zod"

export const KajaSettingsSchema = z.object({
  thinking: z.boolean().optional(),
  sounds: z.boolean().optional()
})

export const KajaConfigSchema = z.object({
  braveApiKey: z.string().min(1),
  openaiApiBaseUrl: z.url(),
  openaiApiKey: z.string().min(1),
  openaiApiModel: z.string().min(1),
  geoServiceUrl: z.url(),
  geoServiceApiKey: z.uuid(),
  // In-app preferences (slash menu); optional so existing configs stay valid.
  settings: KajaSettingsSchema.optional()
})

export type KajaConfig = z.infer<typeof KajaConfigSchema>
export type KajaSettings = z.infer<typeof KajaSettingsSchema>
