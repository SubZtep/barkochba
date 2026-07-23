import { tool } from "../lib/agents"

/**
 * Fetches a URL and returns its content as plain text.
 *
 * @param args.url - The URL to fetch.
 * @returns HTML pages are stripped of tags/scripts/styles down to readable
 * text; other content types are returned as-is.
 */
export const fetchUrlTool = tool<{ url: string }>({
  name: "fetch_url",
  description:
    "Fetch a specific, known URL and return its content as plain text. Use " +
    "this instead of web_search when you already have the exact URL (e.g. " +
    "the user gave you a link, or a prior search result) — it's cheaper and " +
    "returns the actual page instead of a search snippet. The full page " +
    "text is returned unsummarized — if it's long, call summarize on the " +
    "result before replying instead of condensing it yourself.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL to fetch"
      }
    },
    required: ["url"]
  },
  execute: async (args) => {
    const res = await fetch(args.url)
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${args.url}`)
    const body = await res.text()
    const contentType = res.headers.get("content-type") ?? ""
    return contentType.includes("html") ? stripHtml(body) : body
  }
})

function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim()
}
