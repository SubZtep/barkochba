import OpenAI from "openai"
import type { ResolvedModel } from "../schemas/models"

/**
 * Confirms a model is actually served by its provider, via the
 * OpenAI-compatible `GET /models` list endpoint — cheap (no tokens spent)
 * and works the same for chat/stt/tts models alike. Listing rather than
 * `GET /models/{id}` on purpose: many providers (e.g. Fireworks) use
 * slash-containing ids like "accounts/fireworks/models/x", which some
 * providers' `/models/{id}` route 404s on.
 */
export async function checkModelAvailability(
  model: ResolvedModel
): Promise<boolean> {
  const client = new OpenAI({
    apiKey: model.apiKey ?? "none",
    baseURL: model.baseUrl
  })
  try {
    const page = await client.models.list()
    return page.data.some((entry) => entry.id === model.id)
  } catch {
    return false
  }
}
