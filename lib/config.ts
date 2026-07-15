import { join } from "node:path"
import { file, write } from "bun"
import envPaths from "env-paths"
import * as z from "zod"

const KajaSettingsSchema = z.object({
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

const paths = envPaths("kaja", { suffix: "" })
export const configPath = join(paths.config, "config.json")

export async function isExists() {
  const f = file(configPath)
  return await f.exists()
}

export async function validate() {
  const f = file(configPath, { type: "application/json" })
  if (await f.exists()) {
    try {
      const data = await f.json()
      return !!KajaConfigSchema.parse(data)
    } catch (error) {
      console.log(error)
    }
  }
  return false
}

export async function config() {
  const f = file(configPath, { type: "application/json" })
  if (await f.exists()) {
    try {
      return (await f.json()) as KajaConfig
    } catch (error: any) {
      console.log(`Invalid config file at ${configPath}: ${error.message}`)
      process.exit(1)
    }
  } else {
    console.log(`Config file not exists: ${configPath}`)
    process.exit(1)
  }
}

export async function saveSettings(settings: KajaSettings) {
  const current = await config()
  const f = file(configPath, { type: "application/json" })
  await write(f, JSON.stringify({ ...current, settings }, null, 2))
}

export async function create() {
  const data: KajaConfig = {
    braveApiKey: "",
    openaiApiBaseUrl: "",
    openaiApiKey: "",
    openaiApiModel: "",
    geoServiceUrl: "",
    geoServiceApiKey: ""
  }
  const f = file(configPath, { type: "application/json" })
  await write(f, JSON.stringify(data, null, 2))
}
