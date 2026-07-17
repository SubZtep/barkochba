import { join } from "node:path"
import { file, write } from "bun"
import envPaths from "env-paths"
import {
  type KajaConfig,
  KajaConfigSchema,
  type KajaSettings
} from "../schemas/config"

const paths = envPaths("kaja", { suffix: "" })
export const configDir = paths.config
export const configPath = join(configDir, "config.json")

export async function isExists() {
  const f = file(configPath)
  return await f.exists()
}

export async function validate(quiet = false) {
  const f = file(configPath, { type: "application/json" })
  if (await f.exists()) {
    try {
      const data = await f.json()
      return !!KajaConfigSchema.parse(data)
    } catch (error) {
      if (!quiet) console.log(error)
    }
  }
  return false
}

// Tolerant reader for the config wizard prefill: returns whatever is in the
// file (possibly schema-invalid), or {} when missing/unparseable.
export async function readConfigLoose(): Promise<Partial<KajaConfig>> {
  try {
    const data = await file(configPath, { type: "application/json" }).json()
    if (data && typeof data === "object") return data as Partial<KajaConfig>
  } catch {}
  return {}
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

export async function saveConfig(data: KajaConfig) {
  const f = file(configPath, { type: "application/json" })
  await write(f, JSON.stringify(data, null, 2))
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
