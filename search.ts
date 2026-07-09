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
import { braveSearch, isAnswerSatisfactory, rerank, summarize } from "./lib/tools"
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

const exampleQuestions = [
	"Mennyi helyem van?",
	"Hol van a hattérképem Omarchyn?",
	"Hány darab fájl van a home könyvtáramban?",
	"Mennyi egy meg egy?",
	"What is the current weather in London?",
	"Milyen az időjárás Pesten?",
	"Milyen az időjárás?",
	"Mennyi az annyi brarrararaoe?",
	"Mi lesz ma este a tévében?",
	"Hol tudok ma este akciofilmet nezni?"
]

function pickQuestion(): string {
	console.log("\nPick a question:")
	for (const [i, q] of exampleQuestions.entries()) {
		console.log(`${i + 1}. ${q}`)
	}
	const choice = Number(prompt("\n> "))
	return exampleQuestions[choice - 1] ?? exampleQuestions[0]!
}

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
						description:
							"One short sentence in Cili's direct, upbeat voice describing what this command will do — written for the user reading the confirmation prompt, not a dry technical description"
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
	{
		type: "function",
		function: {
			name: "brainstorm_options",
			description:
				"When a request is ambiguous but a reasonable guess is possible, propose 2-4 concrete candidate interpretations instead of guessing blindly or asking outright. Candidates are ranked against the user's request and the best one is returned to you to act on.",
			parameters: {
				type: "object",
				properties: {
					query: {
						type: "string",
						description: "The user's original request, verbatim, used to rank candidates"
					},
					candidates: {
						type: "array",
						minItems: 2,
						maxItems: 4,
						items: {
							type: "object",
							properties: {
								label: {
									type: "string",
									description: "Short human-readable name for this interpretation"
								},
								action_type: {
									type: "string",
									enum: ["command", "question", "answer"],
									description:
										"command: a shell command would satisfy this interpretation. question: this interpretation needs a clarifying question. answer: this interpretation can be answered directly with no action."
								},
								action: {
									type: "string",
									description:
										"For command: the shell command to eventually propose. For question: the clarifying question to eventually ask. For answer: the direct answer text."
								}
							},
							required: ["label", "action_type", "action"]
						}
					}
				},
				required: ["query", "candidates"]
			}
		}
	},
	...mcpTools
]

const messages: ChatCompletionMessageParam[] = [
	{
		role: "system",
		content: `You are "Cili", a sharp, high-energy 20-something developer who doesn't sugarcoat things — unapologetically direct, upbeat, never boring or robotic. Stay Cili in every reply, even though each one is squeezed into the strict format below: the format constrains your words, not your personality.

Hard rules, always in force:
- Answer in a single short sentence, in the language of the question.
- Don't share any filler words, unnecessary information, context, or disclaimers: straight to the point.
- Read acronyms always as English letters, e.g. "AI" is "A I", "CPU" is "C P U".
- The answer is read aloud by TTS: plain speakable text only. No markdown, parentheses, quotes, slashes, symbols, emojis, abbreviations.
- Write units and numbers as spoken, e.g. "25 fok" not "25°C", "20 kilométer per óra" not "20 km/h".
- Your text response is final and cannot be replied to: never ask a question in it, no follow-up offers.
- If the question is ambiguous or missing information: when a reasonable person could guess likely intents, call brainstorm_options with a few concrete candidates first instead of guessing blindly — only call ask_user directly if no reasonable guess is possible, or if the ranked candidate from brainstorm_options still doesn't clearly fit.
- For questions about this machine, answer via system_info instead of guessing.
- Before propose_command, you MUST call system_info with category osInfo first, so you never propose a command for the wrong OS. Only call propose_command when the user wants the machine's state actually changed. Never run anything without going through it.`
	},
	{
		role: "user",
		content: process.argv[2] ?? pickQuestion()
	}
]

let rejectionCount = 0

for (let turn = 0; turn < 20; turn++) {
	const completion = await client.chat.completions.create({
		model: process.env.OPENAI_API_MODEL!,
		messages,
		tools,
		n: 3,
		temperature: 0.7
	})

	const choices = completion.choices.filter((c) => c.message)
	if (!choices.length) {
		log.error({ completion }, "No message in completion")
		break
	}

	let message = choices[0]!.message
	if (choices.length > 1) {
		const blobs = choices.map((c) => {
			const call = c.message.tool_calls?.[0]
			return call?.type === "function"
				? `${call.function.name}\n${call.function.arguments}`
				: c.message.content || ""
		})
		const rankedIdx = await rerank(messages[1]!.content as string, blobs, 1)
		message = choices[rankedIdx[0]!]!.message
	}
	messages.push(message)

	if (!message.tool_calls?.length) {
		const query = messages[1]!.content as string
		const answer = message.content || ""
		if (await isAnswerSatisfactory(query, answer)) {
			console.log(`\n${answer}`)
			await speak(answer || "Közöd?")
			sink.stop()
			break
		}
		rejectionCount++
		log.debug({ query, answer, rejectionCount }, "Answer rejected, looping again")
		if (rejectionCount >= 3) {
			const question =
				"Nem tudom biztosan mit szeretnél, elmondanád pontosabban?"
			await speak(question)
			const reply = prompt(`\n${question}`) ?? ""
			messages.push({
				role: "user",
				content: reply
			})
			rejectionCount = 0
			continue
		}
		const lastTool = [...messages].reverse().find((m) => m.role === "tool")
		const alreadyActed =
			lastTool && typeof lastTool.content === "string" && /"exitCode":0/.test(lastTool.content)
		messages.push({
			role: "user",
			content: alreadyActed
				? `You already ran a command that succeeded — look at its tool result above and report what actually happened, don't just restate your plan or ask again.`
				: `That doesn't actually answer my original request: "${query}". Try again, more specifically. If you genuinely can't guess what I want, call ask_user instead of guessing further.`
		})
		continue
	}

	for (const call of message.tool_calls) {
		if (call.type !== "function") {
			log.warn({ call }, "Unknown tool call type, skipping")
			continue
		}
		const args = JSON.parse(call.function.arguments)
		let content: string
		if (call.function.name === "ask_user") {
			await speak(args.question || "Mondj valamit")
			content = prompt(`\n${args.question}`) ?? ""
		} else if (call.function.name === "system_info") {
			content = JSON.stringify(await si[args.category as (typeof systemInfoCategories)[number]]())
		} else if (call.function.name === "propose_command") {
			content = await runProposedCommand(args.command, args.explanation, speak)
		} else if (call.function.name === "brainstorm_options") {
			const candidates: { label: string; action_type: string; action: string }[] =
				args.candidates
			const rankedIdx = await rerank(
				args.query,
				candidates.map((c) => `${c.label}\n${c.action}`),
				1
			)
			const winner = candidates[rankedIdx[0]!]!
			const runnerUp = rankedIdx[1] !== undefined ? candidates[rankedIdx[1]] : null
			content = JSON.stringify({
				best_guess: winner,
				runner_up: runnerUp,
				instructions:
					"Proceed using best_guess: if action_type is command, call propose_command with it (system_info osInfo first if not already called); if action_type is question, call ask_user with it; if action_type is answer, just answer directly. Only fall back to ask_user with a different question if none of the candidates fit."
			})
		} else if (isMcpTool(call.function.name)) {
			content = await callMcpTool(call.function.name, args)
		} else {
			const result = await braveSearch(
				args.query,
				args.freshness,
				args.search_lang
			)
			const rankedIdx = await rerank(
				args.query,
				result.map((r: { title: string; description: string }) => `${r.title}\n${r.description}`)
			)
			const ranked = rankedIdx.map((i) => result[i])
			content = await summarize(args.query, ranked)
		}
		messages.push({
			role: "tool",
			tool_call_id: call.id,
			content
		})
	}
}

playSound("bell")
process.exit()
