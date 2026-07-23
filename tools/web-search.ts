import { tool } from "../lib/agents"
import { config } from "../lib/config"
import { tryLookupMyLocation } from "../lib/geo"
import { isoCountryCode } from "../lib/iso-countries"

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
  description: "Search the web for current information.",
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
  execute: async (args) =>
    JSON.stringify(
      await braveSearch(args.query, args.freshness, args.search_lang)
    )
})

interface BraveSearchResult {
  type: "search"
  query: {
    original: string
    show_strict_warning: boolean
    is_navigational: boolean
    is_news_breaking: boolean
    spellcheck_off: boolean
    country: string
    bad_results: boolean
    should_fallback: boolean
    postal_code: string
    city: string
    header_country: string
    more_results_available: boolean
    state: string
  }
  mixed: {
    type: "mixed"
    main: {
      type: "web"
      index: number
      all: boolean
    }[]
    top: []
    side: []
  }
  web: {
    type: "search"
    results: {
      title: string
      url: string
      is_source_local: boolean
      is_source_both: boolean
      description: string
      profile: any[]
      language: string
      family_friendly: boolean
      type: "search_result"
      subtype: "generic" | "product" | "creative_work"
      is_live: boolean
      meta_url: {
        schema: "https"
        netloc: string
        hostname: string
        favicon: string
        path: string
      }
      organization?: {
        type: "organization"
        name: string
        contact_points: any[]
      }
      thumbnail?: {
        src: string
        original: string
      }
      extra_snippets: string[]
    }[]
    family_friendly: boolean
  }
}

async function braveSearch(
  query: string,
  freshness?: string,
  search_lang?: string
) {
  const location = await tryLookupMyLocation()
  const country = location && isoCountryCode(location.country.name)
  const params = new URLSearchParams({
    q: query,
    count: "20",
    ...(freshness ? { freshness } : {}),
    text_decorations: "false",
    ...(country ? { country } : {}),
    search_lang: search_lang ?? "hu",
    result_filter: "web"
  })
  const res = await fetch(
    `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
    {
      headers: {
        "X-Subscription-Token": (await config()).webSearch?.apiKey ?? ""
      }
    }
  )
  if (!res.ok)
    throw new Error(`Brave search failed: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as BraveSearchResult
  return (data.web?.results ?? []).map((result) => ({
    title: result.title,
    url: result.url,
    description: result.description
  }))
}
