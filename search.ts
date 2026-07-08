import { client } from "./lib/openai"
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions"
import { log } from "./lib/logger"
import { playSound } from "./lib/my-computer"
import { createTts } from "./lib/tts"
import { createLocalSink } from "./lib/frontends/local"

const sink = createLocalSink()
const { speak } = createTts(sink)

async function braveSearch(query: string, freshness?: string, search_lang?: string) {
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
      model: process.env.OPENAI_API_MODEL_RERANK!,
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
    model: process.env.OPENAI_API_MODEL_SUMMARISE!,
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
        query: { type: "string", description: "The search query" },
        freshness: {
          type: "string",
          enum: ["pd", "pw", "pm", "py"],
          description: "How recent results must be: past day, week, month, or year. Omit for timeless facts."
        },
        search_lang: { type: "string", description: "2-letter language code of the query, e.g. hu, en" }
      },
      required: ["query"]
    }
  }
}, {
  type: "function",
  function: {
    name: "ask_user",
    description: "The only way to ask the user a clarifying question. Questions written in a normal text response will never be seen or answered.",
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
  // content: `Answer the user's question in a single short sentence, in the same language as the question.\nYour text response is final: the user cannot reply to it, so never ask questions in it.\nIf the question is ambiguous or missing information, you MUST call the ask_user tool to ask, instead of guessing or refusing.\nNo markdown, no follow-up offers.
  content: `Answer the user's question in a single short sentence, in the language as the question. Your answer will be read aloud by a text-to-speech engine: write plain speakable text only.
  No markdown, no parentheses, no quotes, no slashes, no symbols, no emojis, no abbreviations.
  Write units and numbers the way they are spoken, for example "25 fok" instead of "25°C" and "20 kilométer per óra" instead of "20 km/h".
  Your text response is final: the user cannot reply to it, so never ask questions in it.
  If the question is ambiguous or missing information, you MUST call the ask_user tool to ask, instead of guessing or refusing.
  No follow-up offers.`
}, {
  role: "user",
  content: process.argv[2] ?? "Mennyi egy meg egy?"
  // content: process.argv[2] ?? "What is the current weather in London?"
  // content: process.argv[2] ?? "Milyen az időjárás Pesten?"
  // content: process.argv[2] ?? "Milyen az időjárás?"
  // content: process.argv[2] ?? "Mennyi az annyi brarrararaoe?"
  // content: process.argv[2] ?? "Mi lesz ma este a tévében?"
  // content: process.argv[2] ?? "Hol tudok ma este akciofilmet nezni?"
}]

for (let turn = 0; turn < 10; turn++) {
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
    await speak(message.content || "Közöd?")
    sink.stop()
    break
  }

  for (const call of message.tool_calls) {
    if (call.type !== "function") {
      log.warn({ call }, "Unknown tool call type, skipping")
      continue
    }
    const args = JSON.parse(call.function.arguments)
    let content: string
    if (call.function.name === "ask_user") {
      // playSound("bell")
      await speak(args.question || "Mondj valamit")
      content = prompt(`\n${args.question}`) ?? ""
    } else {
      playSound("magic")
      // console.log(`[searching: ${args.query}]`)
      const result = await braveSearch(args.query, args.freshness, args.search_lang)
      playSound("magic")
      const ranked = await rerank(args.query, result)
      playSound("magic")
      content = await summarize(args.query, ranked)
    }
    messages.push({
      role: "tool",
      tool_call_id: call.id,
      content
    })
  }
}
