import { join } from "node:path"
import { file, TOML, write } from "bun"
import {
  type KajaModelsFile,
  ModelsFileSchema,
  type ResolvedModel
} from "../schemas/models"
import { configDir } from "./config"
import { t } from "./i18n"

export const modelsPath = join(configDir, "models.toml")

// Written on first run; everything is commented out, which parses as an
// empty (valid) file until the user fills it in.
const TEMPLATE = `# Models available to Kaja, one [[models]] entry each.
#
# Credentials live in named [providers.*] tables so they are never repeated
# per model. A model picks one with \`provider = "<name>"\`; models that don't
# name one use [providers.default].

# [providers.default]
# base_url = "https://api.fireworks.ai/inference/v1"
# api_key = "fw-..."

# [providers.speaches]
# base_url = "http://localhost:8000"   # local server, no key needed

# [[models]]
# id = "accounts/fireworks/models/deepseek-v3p1"
# label = "DeepSeek fast"
# task = "chat"                        # chat | text-to-speech | speech-to-text

# [[models]]
# id = "speaches-ai/Kokoro-82M-v1.0-ONNX-fp16"
# task = "text-to-speech"
# provider = "speaches"
`

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
 * Load the models file. Missing file: writes a commented template and
 * returns no models (the app works without them). Invalid file: prints the
 * error and exits, same policy as {@link config}.
 */
export async function loadModels(): Promise<ResolvedModel[]> {
  const f = file(modelsPath)
  if (!(await f.exists())) {
    await write(f, TEMPLATE)
    return []
  }
  try {
    return resolveModels(ModelsFileSchema.parse(TOML.parse(await f.text())))
  } catch (error: any) {
    console.log(
      t("models.invalidAt", { path: modelsPath, message: error.message })
    )
    process.exit(1)
  }
}
