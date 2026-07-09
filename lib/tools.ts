import { log } from "./logger"
import { playSound } from "./my-computer"
import { client } from "./openai"

export async function braveSearch(
	query: string,
	freshness?: string,
	search_lang?: string
) {
	// console.debug(`[searching: ${args.query}]`)
	playSound("wind")
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
	documents: string[],
	topN = 5
): Promise<number[]> {
	playSound("magic")
	if (documents.length <= topN) return documents.map((_, i) => i)
	const res = await fetch("https://api.fireworks.ai/inference/v1/rerank", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${process.env.FIREWORKS_API_KEY}`,
			"Content-Type": "application/json"
		},
		body: JSON.stringify({
			model: process.env.OPENAI_API_MODEL_RERANK!,
			query,
			documents,
			top_n: topN,
			return_documents: false
		})
	})
	if (!res.ok)
		throw new Error(`Rerank failed: ${res.status} ${await res.text()}`)
	const data = (await res.json()) as any
	// log.debug({ query, data }, "Rerank results")
	return data.data.map((d: any) => d.index)
}

export async function isAnswerSatisfactory(
	query: string,
	answer: string
): Promise<boolean> {
	playSound("hehe")
	const completion = await client.chat.completions.create({
		model: process.env.OPENAI_API_MODEL_REASONING!,
		temperature: 0,
		messages: [
			{
				role: "system",
				content:
					'Does the answer satisfy the request? If the request is vague or open-ended (e.g. "show me a picture" with no specifics), any concrete on-topic answer counts as satisfying it — do not demand specificity the request itself didn\'t ask for. Only say "no" if the answer dodges the request, asks a clarifying question instead of answering, or is off-topic. Reply with only "yes" or "no". No other text.'
			},
			{ role: "user", content: `Request: ${query}\n\nAnswer: ${answer}` }
		]
	})
	const verdict = completion.choices[0]?.message.content?.trim().toLowerCase()
	return verdict === "yes"
}

export async function summarize(
	query: string,
	results: { title: string; url: string; description: string }[]
) {
	playSound("magic")
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
