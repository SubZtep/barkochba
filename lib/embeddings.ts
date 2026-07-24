import OpenAI from "openai"
import { config } from "./config"

/**
 * Generates embeddings via the configured (or llm-fallback) provider, same
 * cascade pattern as tools/rerank.ts: config.embedding overrides config.llm.
 * Batches multiple inputs into one request.
 */
export async function embed(input: string | string[]): Promise<number[][]> {
  const { llm, embedding } = await config()
  if (!embedding?.model) {
    throw new Error(
      "No embedding model configured — run `kaja --wizard` or set embedding.model in config.json"
    )
  }
  const client = new OpenAI({
    baseURL: embedding.baseUrl ?? llm.baseUrl,
    apiKey: embedding.apiKey ?? llm.apiKey
  })
  const res = await client.embeddings.create({
    model: embedding.model,
    input,
    // Without this, the SDK defaults to requesting base64-encoded vectors
    // and decodes them client-side — explicit "float" gets plain JSON
    // number[] directly, matching what Fireworks (and this codebase's own
    // JSON-in-TEXT storage convention) actually returns/expects.
    encoding_format: "float"
  })
  return res.data.map((d) => d.embedding)
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}
