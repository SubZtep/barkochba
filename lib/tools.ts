import { log } from "./logger"
import { client } from "./openai"

export async function braveSearch(
	query: string,
	freshness?: string,
	search_lang?: string
) {
	const params = new URLSearchParams({
		q: query,
		count: "20",
		...(freshness ? { freshness } : {}),
		text_decorations: "false",
		// country: "GB",
		search_lang: search_lang ?? "hu",
		result_filter: "web"
	})
	const res = await fetch(
		`https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
		{ headers: { "X-Subscription-Token": process.env.BRAVE_API_KEY! } }
	)
	if (!res.ok)
		throw new Error(`Brave search failed: ${res.status} ${await res.text()}`)
	const data = (await res.json()) as any
	// log.debug({ query, data }, "Brave search results")
	return (data.web?.results ?? []).map((r: any) => ({
		title: r.title,
		url: r.url,
		description: r.description
	}))
}

export async function rerank(
	query: string,
	results: { title: string; url: string; description: string }[],
	topN = 5
) {
	if (results.length <= topN) return results
	const res = await fetch("https://api.fireworks.ai/inference/v1/rerank", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${process.env.FIREWORKS_API_KEY}`,
			"Content-Type": "application/json"
		},
		body: JSON.stringify({
			model: process.env.OPENAI_API_MODEL_RERANK!,
			query,
			documents: results.map((r) => `${r.title}\n${r.description}`),
			top_n: topN,
			return_documents: false
		})
	})
	if (!res.ok)
		throw new Error(`Rerank failed: ${res.status} ${await res.text()}`)
	const data = (await res.json()) as any
	log.debug({ query, data }, "Rerank results")
	return data.data.map((d: any) => results[d.index])
}

export async function summarize(
	query: string,
	results: { title: string; url: string; description: string }[]
) {
	const completion = await client.chat.completions.create({
		model: process.env.OPENAI_API_MODEL_SUMMARISE!,
		// model: "accounts/fireworks/models/deepseek-v4-flash",
		messages: [
			// {
			//   role: "developer",
			//   content: `You are a helpful assistant that summarizes search results into a single sentence.\nIgnore irrelevant information.\nAnswer in Hungarian language.`
			// },
			{
				role: "user",
				content: `Query: ${query}\n\nResults:\n${results.map((r) => `- ${r.title}: ${r.description}`).join("\n")}`
				// content: `Summarize the search results below into a single sentence that answers the query. Respond in the language of the query.\n\nQuery: ${query}\n\nResults:\n${results.map(r => `- ${r.title}: ${r.description}`).join("\n")}`
				// content: `Foglald össze a keresési eredményeket egyetlen mondatban, amely válaszol a kérdésre. Hagyd figyelmen kívül az irreleváns információkat. Válaszolj a lekérdezés nyelvén.\n\nLekérdezés: ${query}\n\nEredmények:\n${results.map(r => `- ${r.title}: ${r.description}`).join("\n")}`
			}
		]
	})
	const summary = completion.choices[0]?.message.content ?? ""
	log.debug({ query, summary }, "Search summary")
	return summary
}
