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
 * Embedding models: same false-negative issue on Fireworks (confirmed:
 * embedding models are absent from `/models` too), so probe with a real
 * 1-word embedding request instead of trusting the list.
 *
 * Speech-to-text (speaches): `POST /v1/models/{id}` asks the server to load
 * the model — a real, cheap probe (no audio needed) that confirms the
 * model id is actually servable, unlike a `GET /models` list lookup.
 *
 * Everything else (text-to-speech/image-generation): no cheap equivalent
 * probe exists (a real call means generating audio or an image), so these
 * fall back to the `GET /models` list as a best-effort signal.
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
    if (model.task === "embedding") {
      await client.embeddings.create({
        model: model.id,
        input: "hi",
        encoding_format: "float"
      })
      return true
    }
    if (model.task === "speech-to-text") {
      const res = await fetch(
        `${model.baseUrl}/v1/models/${encodeURIComponent(model.id)}`,
        { method: "POST" }
      )
      return res.ok
    }
    const page = await client.models.list()
    return page.data.some((entry) => entry.id === model.id)
  } catch {
    return false
  }
}
