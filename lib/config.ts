import { join } from "node:path"
import { file, write } from "bun"
// Written on first run: a minimal config with no llm block (provider
// choice/credentials come from the setup wizard's preset step, which
// derives llm/embedding/imageGen from docs/config/models*.toml and
// overwrites this file before the app proceeds). Missing llm fails
// KajaConfigSchema validation, so cli.tsx forces the setup wizard on every
// first run regardless of validation. TS's built-in resolveJsonModule typing
// wins over the `text` attribute, so the raw import is typed as the parsed
// object rather than a string.
import rawTemplate from "../docs/config/config.json" with { type: "text" }
import {
  type KajaConfig,
  KajaConfigSchema,
  type KajaSettings
} from "../schemas/config"
import { t } from "./i18n"
import { getPaths } from "./paths"

const TEMPLATE = rawTemplate as unknown as string

// Computed fresh on every call rather than as a module-level constant: tests
// run many spec files in one process and mutate XDG_CONFIG_HOME per file, so
// a frozen constant would lock in whichever file happened to import this
// module first, for the rest of the process.
export function getConfigDir() {
  return getPaths().config
}

export function getConfigPath() {
  return join(getConfigDir(), "config.json")
}

export async function isExists() {
  const f = file(getConfigPath())
  return await f.exists()
}

export async function validate(quiet = false) {
  const f = file(getConfigPath(), { type: "application/json" })
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
    const data = await file(getConfigPath(), {
      type: "application/json"
    }).json()
    if (data && typeof data === "object") return data as Partial<KajaConfig>
  } catch {}
  return {}
}

// Cached after the first read: the file only changes via saveConfig/
// saveSettings below (and invalidateConfigCache, for writers outside this
// module), so every other reader (stt/tts/geo, called often and
// per-utterance) doesn't hit disk each time.
let cached: KajaConfig | undefined

/** Clears the config() cache after a write made outside saveConfig/saveSettings — e.g. lib/memory-store.ts persisting a resolved default path into config.json. */
export function invalidateConfigCache() {
  cached = undefined
}

export async function config() {
  if (cached) return cached
  const configPath = getConfigPath()
  const f = file(configPath, { type: "application/json" })
  if (await f.exists()) {
    try {
      cached = (await f.json()) as KajaConfig
      return cached
    } catch (error: any) {
      console.log(
        t("config.invalidAt", { path: configPath, message: error.message })
      )
      process.exit(1)
    }
  } else {
    console.log(t("config.notExists", { path: configPath }))
    process.exit(1)
  }
}

export async function saveConfig(data: KajaConfig) {
  const f = file(getConfigPath(), { type: "application/json" })
  await write(f, JSON.stringify(data, null, 2))
  cached = undefined
}

export async function saveSettings(settings: KajaSettings) {
  const current = await config()
  const f = file(getConfigPath(), { type: "application/json" })
  // Merge into the existing block: callers persist only the keys they manage
  // (thinking/sounds/voice) and must not drop others like language.
  await write(
    f,
    JSON.stringify(
      { ...current, settings: { ...current.settings, ...settings } },
      null,
      2
    )
  )
  cached = undefined
}

export async function create() {
  const f = file(getConfigPath(), { type: "application/json" })
  await write(f, TEMPLATE)
}
