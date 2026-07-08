import { client } from "./lib/openai"
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions"
import { log } from "./lib/logger"

async function braveSearch(query: string) {
  const params = new URLSearchParams({
    q: query,
    count: "20",
    freshness: "pw",
    text_decorations: "false",
    // country: "GB",
    search_lang: "hu",
    result_filter: "web"
  })
  const res = await fetch(
    `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
    { headers: { "X-Subscription-Token": process.env.BRAVE_API_KEY! } }
  )
  if (!res.ok) throw new Error(`Brave search failed: ${res.status} ${await res.text()}`)
  const data = await res.json() as any
  // log.debug({ query, data }, "Brave search results")
  return (data.web?.results ?? []).map((r: any) => ({
    title: r.title,
    url: r.url,
    description: r.description
  }))
}

async function rerank(query: string, results: { title: string, url: string, description: string }[], topN = 5) {
  if (results.length <= topN) return results
  const res = await fetch("https://api.fireworks.ai/inference/v1/rerank", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.FIREWORKS_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "accounts/fireworks/models/qwen3-reranker-8b",
      query,
      documents: results.map(r => `${r.title}\n${r.description}`),
      top_n: topN,
      return_documents: false
    })
  })
  if (!res.ok) throw new Error(`Rerank failed: ${res.status} ${await res.text()}`)
  const data = await res.json() as any
  log.debug({ query, data }, "Rerank results")
  return data.data.map((d: any) => results[d.index])
}

async function summarize(query: string, results: { title: string, url: string, description: string }[]) {
  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_API_MODEL_RERANK!,
    // model: "accounts/fireworks/models/deepseek-v4-flash",
    messages: [
      // {
      //   role: "developer",
      //   content: `You are a helpful assistant that summarizes search results into a single sentence.\nIgnore irrelevant information.\nAnswer in Hungarian language.`
      // },
      {
        role: "user",
        content: `Query: ${query}\n\nResults:\n${results.map(r => `- ${r.title}: ${r.description}`).join("\n")}`
        // content: `Summarize the search results below into a single sentence that answers the query. Respond in the language of the query.\n\nQuery: ${query}\n\nResults:\n${results.map(r => `- ${r.title}: ${r.description}`).join("\n")}`
        // content: `Foglald össze a keresési eredményeket egyetlen mondatban, amely válaszol a kérdésre. Hagyd figyelmen kívül az irreleváns információkat. Válaszolj a lekérdezés nyelvén.\n\nLekérdezés: ${query}\n\nEredmények:\n${results.map(r => `- ${r.title}: ${r.description}`).join("\n")}`
      }]
  })
  const summary = completion.choices[0]!.message.content ?? ""
  log.debug({ query, summary }, "Search summary")
  return summary
}

const tools: ChatCompletionTool[] = [{
  type: "function",
  function: {
    name: "web_search",
    description: "Search the web for current information.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" }
      },
      required: ["query"]
    }
  }
}, {
  type: "function",
  function: {
    name: "ask_user",
    description: "Ask the user a short clarifying question when their request is ambiguous or missing information.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The clarifying question" }
      },
      required: ["question"]
    }
  }
}]

const messages: ChatCompletionMessageParam[] = [{
  role: "system",
  content: `Answer the user's question in a single short sentence, in the same language as the question.\nIf the question is ambiguous or missing information, ask with the ask_user tool instead of guessing or refusing.\nNo markdown, no follow-up offers.`
}, {
  role: "user",
  // content: process.argv[2] ?? "What is the current weather in London?"
  content: process.argv[2] ?? "Milyen az időjárás Pesten?"
  // content: process.argv[2] ?? "Milyen az időjárás?"
  // content: process.argv[2] ?? "Mennyi az annyi brarrararaoe?"
}]

for (let turn = 0; turn < 5; turn++) {
  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_API_MODEL!,
    messages,
    tools
  })

  const message = completion.choices[0]!.message
  messages.push(message)

  if (!message.tool_calls?.length) {
    // log.debug({ message }, "No tool calls, final response")
    log.debug({ messages }, "Messages log")
    console.log(`\n${message.content}`)
    break
  }

  for (const call of message.tool_calls) {
    if (call.type !== "function") continue
    const args = JSON.parse(call.function.arguments)
    let content: string
    if (call.function.name === "ask_user") {
      content = prompt(`\n${args.question}`) ?? ""
    } else {
      // console.log(`[searching: ${args.query}]`)
      const results = await rerank(args.query, await braveSearch(args.query))
      content = await summarize(args.query, results)
    }
    messages.push({
      role: "tool",
      tool_call_id: call.id,
      content
    })
  }
}
