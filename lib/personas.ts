import { join } from "node:path"
import { file, TOML, write } from "bun"
// Written on first run: the stock assistant plus the app's former built-in
// personas, active, sourced from the same file that documents
// personas.toml on the docs site.
import TEMPLATE from "../docs/config/personas.toml" with { type: "text" }
import type { ResolvedModel } from "../schemas/models"
import {
  type KajaPersonasFile,
  type Persona,
  PersonasFileSchema
} from "../schemas/personas"
import { getConfigDir } from "./config"
import { t } from "./i18n"

export type { Persona }

export function getPersonasPath() {
  return join(getConfigDir(), "personas.toml")
}

/**
 * Load the personas file. Missing file: writes the example template and
 * returns its active personas. Invalid file, or a persona naming a model id
 * not present in `models`: prints the error and exits, same policy as
 * {@link config}.
 */
export async function loadPersonas(
  models: ResolvedModel[]
): Promise<Persona[]> {
  const personasPath = getPersonasPath()
  const f = file(personasPath)
  // Parse TEMPLATE directly rather than reading it back: a freshly written
  // BunFile can report stale (empty) content on an immediate re-read.
  const exists = await f.exists()
  if (!exists) await write(f, TEMPLATE)
  const text = exists ? await f.text() : TEMPLATE
  try {
    const data = PersonasFileSchema.parse(TOML.parse(text)) as KajaPersonasFile
    const modelIds = new Set(models.map((m) => m.id))
    for (const persona of data.personas) {
      if (persona.model && !modelIds.has(persona.model))
        throw new Error(
          `Persona "${persona.id}" names unknown model "${persona.model}"`
        )
    }
    return data.personas
  } catch (error: any) {
    console.log(
      t("personas.invalidAt", { path: personasPath, message: error.message })
    )
    process.exit(1)
  }
}
