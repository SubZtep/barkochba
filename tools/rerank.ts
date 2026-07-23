import { ToolError, tool } from "../lib/agents"
import { config } from "../lib/config"

const DEFAULT_MODEL = "accounts/fireworks/models/qwen3-reranker-8b"
const DEFAULT_BASE_URL = "https://api.fireworks.ai/inference/v1"

/**
 * Reranks a list of documents by relevance to a query, using a dedicated
 * reranker model (default: Fireworks' qwen3-reranker-8b). Falls back to the
 * main llm provider's baseUrl/apiKey when config.rerank doesn't override them.
 *
 * @param args.query - The search query to rank documents against.
 * @param args.documents - The documents to rank, most relevant first in the result.
 * @param args.top_n - Optional cap on how many ranked documents to return.
 */
export const rerankTool = tool<{
  query: string
  documents: string[]
  top_n?: number
}>({
  name: "rerank",
  description:
    "Rank a list of documents by relevance to a query, most relevant first. " +
    "Use this after search/retrieval to reorder or filter candidate passages " +
    "by relevance before reasoning over them.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query to rank documents against"
      },
      documents: {
        type: "array",
        items: { type: "string" },
        description: "The documents to rank"
      },
      top_n: {
        type: "integer",
        description:
          "Optional cap on how many top-ranked documents to return. Omit to return all."
      }
    },
    required: ["query", "documents"]
  },
  execute: async (args) => JSON.stringify(await rerank(args))
})

interface RerankResponse {
  object: "list"
  model: string
  data: {
    index: number
    relevance_score: number
    document?: string
  }[]
  usage: { prompt_tokens: number; total_tokens: number }
}

async function rerank(args: {
  query: string
  documents: string[]
  top_n?: number
}) {
  const { llm, rerank } = await config()
  const baseUrl = rerank?.baseUrl ?? llm.baseUrl ?? DEFAULT_BASE_URL
  const apiKey = rerank?.apiKey ?? llm.apiKey
  const model = rerank?.model ?? DEFAULT_MODEL

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/rerank`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify({
      model,
      query: args.query,
      documents: args.documents,
      ...(args.top_n ? { top_n: args.top_n } : {})
    })
  })
  if (!res.ok)
    throw new ToolError(
      "rerank",
      `Rerank failed: ${res.status} ${await res.text()}`
    )
  const data = (await res.json()) as RerankResponse
  return data.data.map((result) => ({
    index: result.index,
    relevance_score: result.relevance_score,
    document: result.document
  }))
}
