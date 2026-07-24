import { join } from "node:path"
import { file, TOML, write } from "bun"
// Written on first run: an example provider/model catalog, sourced from the
// same file that documents models.toml on the docs site.
import TEMPLATE from "../docs/config/models.toml" with { type: "text" }
import type { KajaConfig } from "../schemas/config"
import {
  type KajaModelsFile,
  ModelsFileSchema,
  type ResolvedModel
} from "../schemas/models"
import { getConfigDir } from "./config"
import { DEFAULT_MODEL as DEFAULT_EMBEDDING_MODEL } from "./embeddings"
import { t } from "./i18n"

export function getModelsPath() {
  return join(getConfigDir(), "models.toml")
}

/** Flatten each model entry with its provider's credentials. */
export function resolveModels(data: KajaModelsFile): ResolvedModel[] {
  return data.models.map((model) => {
    // The schema guarantees the referenced provider exists.
    const provider = data.providers[model.provider ?? "default"]!
    return {
      id: model.id,
      label: model.label,
      task: model.task,
      baseUrl: provider.base_url,
      apiKey: provider.api_key
    }
  })
}

/**
 * config.json's embedding/imageGen blocks aren't part of models.toml (each
 * is a single model, not a catalog), but the startup panel reports on their
 * reachability the same way as chat/tts/stt — so resolve them into the same
 * shape here rather than teaching the panel a second data source.
 */
export function resolveConfigModels(
  config: Pick<KajaConfig, "llm" | "embedding" | "imageGen">
): ResolvedModel[] {
  const models: ResolvedModel[] = [
    {
      id: config.embedding?.model ?? DEFAULT_EMBEDDING_MODEL,
      task: "embedding",
      baseUrl: config.embedding?.baseUrl ?? config.llm.baseUrl,
      apiKey: config.embedding?.apiKey ?? config.llm.apiKey
    }
  ]
  // Without an explicit model, imageGen relies on the provider's own
  // default and there's no id left to check against the /models list, so
  // there's nothing meaningful to report — skip rather than show a check
  // that would always read as "down".
  if (config.imageGen?.model) {
    models.push({
      id: config.imageGen.model,
      task: "image-generation",
      baseUrl: config.imageGen.baseUrl,
      apiKey: config.imageGen.apiKey
    })
  }
  return models
}

/**
 * Load the models file. Missing file: writes the example template and
 * returns its resolved models. Invalid file: prints the error and exits,
 * same policy as {@link config}.
 */
export async function loadModels(): Promise<ResolvedModel[]> {
  const modelsPath = getModelsPath()
  const f = file(modelsPath)
  // Parse TEMPLATE directly rather than reading it back: a freshly written
  // BunFile can report stale (empty) content on an immediate re-read.
  const exists = await f.exists()
  if (!exists) await write(f, TEMPLATE)
  const text = exists ? await f.text() : TEMPLATE
  try {
    return resolveModels(ModelsFileSchema.parse(TOML.parse(text)))
  } catch (error: any) {
    console.log(
      t("models.invalidAt", { path: modelsPath, message: error.message })
    )
    process.exit(1)
  }
}
