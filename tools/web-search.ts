import { ToolError, type ToolResult, tool } from "../lib/agents"
import { config } from "../lib/config"
import { tryLookupMyLocation } from "../lib/geo"

/**
 * Searches the web via Brave Search API.
 *
 * @param args.query - The search query.
 * @param args.freshness - How recent results must be: past day, week, month, or year.
 * @param args.search_lang - 2-letter language code of the query, e.g. hu, en.
 */
export const webSearchTool = tool<{
  query: string
  freshness?: "pd" | "pw" | "pm" | "py"
  search_lang?: string
}>({
  name: "web_search",
  description:
    "Search the web for current information. Cite sources in the reply as markdown links, e.g. [title](url).",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query"
      },
      freshness: {
        type: "string",
        enum: ["pd", "pw", "pm", "py"],
        description:
          "How recent results must be: past day, week, month, or year. Omit for timeless facts."
      },
      search_lang: {
        type: "string",
        description: "2-letter language code of the query, e.g. hu, en"
      }
    },
    required: ["query"]
  },
  execute: async (args): Promise<ToolResult> => {
    const results = await braveSearch(
      args.query,
      args.freshness,
      args.search_lang
    )

    return { text: JSON.stringify(results) }
  }
})

interface BraveLLMContextResult {
  grounding: {
    generic: {
      url: string
      title: string
      snippets: string[]
    }[]
  }
  sources: Record<
    string,
    {
      title: string
      hostname: string
      age: string[] | null
    }
  >
}

async function braveSearch(
  query: string,
  freshness?: string,
  search_lang?: string
) {
  const location = await tryLookupMyLocation()
  const country = location?.country.isoCode
  const params = new URLSearchParams({
    q: query,
    ...(freshness ? { freshness } : {}),
    ...(country ? { country } : {}),
    search_lang: search_lang ?? "hu"
  })
  const res = await fetch(
    `https://api.search.brave.com/res/v1/llm/context?${params.toString()}`,
    {
      headers: {
        "X-Subscription-Token": (await config()).webSearch?.apiKey ?? ""
      }
    }
  )
  if (!res.ok)
    throw new ToolError(
      "web_search",
      `Brave search failed: ${res.status} ${await res.text()}`
    )
  const data = (await res.json()) as BraveLLMContextResult

  return (data.grounding?.generic ?? []).map((result) => ({
    title: result.title,
    url: result.url,
    snippets: result.snippets
  }))
}
