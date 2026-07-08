import type {
	ChatCompletionMessageParam,
	ChatCompletionTool
} from "openai/resources/chat/completions"
import si from "systeminformation"
import { createLocalSink } from "./lib/frontends/local"
import { log } from "./lib/logger"
import { callMcpTool, isMcpTool, mcpTools } from "./lib/mcp"
import { playSound, runProposedCommand } from "./lib/my-computer"
import { client } from "./lib/openai"
import { braveSearch, rerank, summarize } from "./lib/tools"
import { createTts } from "./lib/tts"

const systemInfoCategories = [
	"osInfo",
	"cpu",
	"mem",
	"diskLayout",
	"fsSize",
	"networkInterfaces",
	"wifiConnections",
	"processes",
	"graphics",
	"audio",
	"battery",
	"users"
] as const satisfies readonly (keyof typeof si)[]

const sink = createLocalSink()
const { speak } = createTts(sink)

const tools: ChatCompletionTool[] = [
	{
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
						description:
							"How recent results must be: past day, week, month, or year. Omit for timeless facts."
					},
					search_lang: {
						type: "string",
						description: "2-letter language code of the query, e.g. hu, en"
					}
				},
				required: ["query"]
			}
		}
	},
	{
		type: "function",
		function: {
			name: "system_info",
			description:
				"Query read-only information about this machine (OS, disks, network, processes, graphics, audio, battery, users) to figure out what's possible or find the right command. Call it as many times as needed to narrow in before answering or proposing a command.",
			parameters: {
				type: "object",
				properties: {
					category: {
						type: "string",
						enum: systemInfoCategories,
						description: "Which systeminformation category to query"
					}
				},
				required: ["category"]
			}
		}
	},
	{
		type: "function",
		function: {
			name: "propose_command",
			description:
				"Propose a single shell command to change the machine's state (not just query it). Only call this when the user's request needs an actual change made, never to answer a question. Check system_info first if unsure the command is right. The user will be shown the command and explanation and must confirm before it runs.",
			parameters: {
				type: "object",
				properties: {
					command: { type: "string", description: "The full shell command to run" },
					explanation: {
						type: "string",
						description: "One plain-language sentence describing what this command will do"
					}
				},
				required: ["command", "explanation"]
			}
		}
	},
	{
		type: "function",
		function: {
			name: "ask_user",
			description:
				"The only way to ask the user a clarifying question. Questions written in a normal text response will never be seen or answered.",
			parameters: {
				type: "object",
				properties: {
					question: { type: "string", description: "The clarifying question" }
				},
				required: ["question"]
			}
		}
	},
	...mcpTools
]

const messages: ChatCompletionMessageParam[] = [
	{
		role: "system",
		content: `Answer the user's question in a single short sentence, in the language as the question. Your answer will be read aloud by a text-to-speech engine: write plain speakable text only.
  No markdown, no parentheses, no quotes, no slashes, no symbols, no emojis, no abbreviations.
  Write units and numbers the way they are spoken, for example "25 fok" instead of "25°C" and "20 kilométer per óra" instead of "20 km/h".
  Your text response is final: the user cannot reply to it, so never ask questions in it.
  If the question is ambiguous or missing information, you MUST call the ask_user tool to ask, instead of guessing or refusing.
  If the request only needs information about this machine, answer it using the system_info tool. Before calling propose_command you MUST first call system_info with category osInfo to see what OS and platform this machine actually runs, so you never guess a command for the wrong OS. Only call propose_command when the user wants the machine's state actually changed, and never run anything without going through it.
  No follow-up offers.`
	},
	{
		role: "user",
		content: process.argv[2] ?? "Mennyi helyem van?"
		// content: process.argv[2] ?? "Hol van a hattérképem Omarchyn?"
		// content: process.argv[2] ?? "Hány darab fájl van a home könyvtáramban?"
		// content: process.argv[2] ?? "Mennyi egy meg egy?"
		// content: process.argv[2] ?? "What is the current weather in London?"
		// content: process.argv[2] ?? "Milyen az időjárás Pesten?"
		// content: process.argv[2] ?? "Milyen az időjárás?"
		// content: process.argv[2] ?? "Mennyi az annyi brarrararaoe?"
		// content: process.argv[2] ?? "Mi lesz ma este a tévében?"
		// content: process.argv[2] ?? "Hol tudok ma este akciofilmet nezni?"
	}
]

for (let turn = 0; turn < 10; turn++) {
	const completion = await client.chat.completions.create({
		model: process.env.OPENAI_API_MODEL!,
		messages,
		tools
	})

	const message = completion.choices[0]?.message
	if (!message) {
		log.error({ completion }, "No message in completion")
		break
	}
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
		} else if (call.function.name === "system_info") {
			content = JSON.stringify(await si[args.category as (typeof systemInfoCategories)[number]]())
		} else if (call.function.name === "propose_command") {
			content = await runProposedCommand(args.command, args.explanation, speak)
		} else if (isMcpTool(call.function.name)) {
			playSound("magic")
			content = await callMcpTool(call.function.name, args)
			playSound("magic")
		} else {
			playSound("magic")
			// console.log(`[searching: ${args.query}]`)
			const result = await braveSearch(
				args.query,
				args.freshness,
				args.search_lang
			)
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

process.exit()
