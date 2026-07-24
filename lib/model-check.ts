import OpenAI from "openai"
import type { ResolvedModel } from "../schemas/models"

/**
 * Confirms a model is actually usable by its provider.
 *
 * Chat models: a real 1-token completion request — the only reliable
 * signal. Some providers' `GET /models` list (and `/models/{id}`) don't
 * enumerate every servable model (confirmed on Fireworks: a model can
 * answer `/chat/completions` while being absent from `/models`), so
 * listing produces false negatives.
 *
 * Everything else (speech-to-text/text-to-speech/embedding/image-generation):
 * no cheap equivalent probe exists (a real call means sending/generating
 * audio, text embeddings, or an image), so these fall back to the
 * `GET /models` list as a best-effort signal.
 */
export async function checkModelAvailability(
  model: ResolvedModel
): Promise<boolean> {
  const client = new OpenAI({
    apiKey: model.apiKey ?? "none",
    baseURL: model.baseUrl
  })
  try {
    if (model.task === "chat") {
      await client.chat.completions.create({
        model: model.id,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1
      })
      return true
    }
    const page = await client.models.list()
    return page.data.some((entry) => entry.id === model.id)
  } catch {
    return false
  }
}
