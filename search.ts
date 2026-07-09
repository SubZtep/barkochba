import type {
	ChatCompletionMessageParam,
	ChatCompletionTool
} from "openai/resources/chat/completions"
import si from "systeminformation"
import { recallRelevant, remember } from "./lib/brain"
import { createLocalSink } from "./lib/frontends/local"
import { log } from "./lib/logger"
import { callMcpTool, isMcpTool, mcpTools } from "./lib/mcp"
import { playSound, runProposedCommand } from "./lib/my-computer"
import { client } from "./lib/openai"
import { lookupSlang } from "./lib/slang"
import {
	braveSearch,
	isAnswerSatisfactory,
	rerank,
	summarize
} from "./lib/tools"
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

type TraceNode = {
	id: string
	label: string
	kind:
		| "query"
		| "memory"
		| "sample"
		| "winner"
		| "tool_call"
		| "tool_result"
		| "brainstorm_candidate"
		| "brainstorm_winner"
		| "challenge"
		| "final_answer"
		| "ask_user"
	from?: string[]
	score?: number
}
const trace: TraceNode[] = []
let nodeSeq = 0
const nodeId = () => `n${nodeSeq++}`
const truncate = (s: string, max = 80) =>
	s.length > max ? `${s.slice(0, max)}…` : s
const escapeLabel = (s: string) =>
	truncate(
		s
			.replace(/"/g, "'")
			.replace(/[\n\r|[\]{}]/g, " ")
			.trim()
	)

function renderMermaid(nodes: TraceNode[]): string {
	const lines = ["flowchart TD"]
	for (const n of nodes) {
		const label = escapeLabel(n.label)
		if (label) {
			const shape =
				n.kind === "query"
					? `${n.id}(["${label}"])`
					: n.kind === "final_answer"
						? `${n.id}[["${label}"]]`
						: n.kind === "ask_user"
							? `${n.id}{{"${label}"}}`
							: `${n.id}["${label}"]`
			lines.push(`\t${shape}`)
		}
	}
	for (const n of nodes) {
		for (const parent of n.from ?? []) {
			const edgeLabel = n.score !== undefined ? `|${n.score.toFixed(2)}|` : ""
			lines.push(`\t${parent} --> ${edgeLabel}${n.id}`)
		}
	}
	return lines.join("\n")
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
					command: {
						type: "string",
						description: "The full shell command to run"
					},
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
			name: "slang_lookup",
			description:
				"Look up Hungarian slang, idioms, or street expressions in a slang dictionary. Call this when the user uses or asks about an expression that sounds like slang and you're not fully sure of its meaning. Returns the closest dictionary entries with definitions, best match first.",
			parameters: {
				type: "object",
				properties: {
					phrase: {
						type: "string",
						description: "The slang expression to look up, as the user said it"
					}
				},
				required: ["phrase"]
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
						description:
							"The user's original request, verbatim, used to rank candidates"
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
									description:
										"Short human-readable name for this interpretation"
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

const query = process.argv[2] ?? pickQuestion()
const rootId = nodeId()
trace.push({ id: rootId, label: query, kind: "query" })

const relevant = await recallRelevant(query)
for (const m of relevant) {
	trace.push({
		id: nodeId(),
		label: `${m.role}: ${m.content}`,
		kind: "memory",
		from: [rootId]
	})
}
let front = rootId

const messages: ChatCompletionMessageParam[] = [
	{
		role: "system",
		content: `You are "Cili", a sharp, high-energy 20-something developer who doesn't sugarcoat things — unapologetically direct, upbeat, never boring or robotic. Stay Cili in every reply, even though each one is squeezed into the strict format below: the format constrains your words, not your personality.

Hard rules, always in force:
- Answer in a single short sentence, in the language of the question.
- Don't share unnecessary information, context, or disclaimers just to fill words. Interestingly, concisely, and directly answer the question.
- Read acronyms always as English letters, e.g. "AI" is "A I", "CPU" is "C P U".
- The answer is read aloud by TTS: plain speakable text only. No markdown, parentheses, quotes, slashes, symbols, emojis, abbreviations.
- Write units and numbers as spoken, e.g. "25 fok" not "25°C", "20 kilométer per óra" not "20 km/h".
- Your text response is final and cannot be replied to: never ask a question in it, no follow-up offers.
- If the question is ambiguous or missing information: when a reasonable person could guess likely intents, call brainstorm_options with a few concrete candidates first instead of guessing blindly — only call ask_user directly if no reasonable guess is possible, or if the ranked candidate from brainstorm_options still doesn't clearly fit.
- For questions about this machine, answer via system_info instead of guessing.
- When the user uses or asks about a Hungarian expression that might be slang or an idiom, call slang_lookup first, even if you think you already know it — everyday-sounding phrases often have a slang meaning that beats the literal one. Prefer a returned definition over your own guess when its meaning fits the conversation.
- Before propose_command, you MUST call system_info with category osInfo first, so you never propose a command for the wrong OS. Only call propose_command when the user wants the machine's state actually changed. Never run anything without going through it.${relevant.length ? `\n\nRelevant past exchanges with this user:\n${relevant.map((m) => `${m.role}: ${m.content}`).join("\n")}` : ""}`
	},
	{
		role: "user",
		content: query
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
		const sampleIds = blobs.map((blob) => {
			const id = nodeId()
			trace.push({ id, label: blob, kind: "sample", from: [front] })
			return id
		})
		const ranked = await rerank(messages[1]!.content as string, blobs, 1)
		message = choices[ranked[0]!.index]!.message
		const winnerId = nodeId()
		trace.push({
			id: winnerId,
			label: blobs[ranked[0]!.index]!,
			kind: "winner",
			from: [sampleIds[ranked[0]!.index]!],
			score: ranked[0]!.score
		})
		front = winnerId
	}
	messages.push(message)

	if (!message.tool_calls?.length) {
		const query = messages[1]!.content as string
		const answer = message.content || ""
		const satisfactory = await isAnswerSatisfactory(query, answer)
		const challengeId = nodeId()
		trace.push({
			id: challengeId,
			label: satisfactory ? "accepted" : `rejected #${rejectionCount + 1}`,
			kind: "challenge",
			from: [front]
		})
		front = challengeId
		if (satisfactory) {
			console.log(`\n${answer}`)
			await speak(answer || "Közöd?")
			await remember(query, answer)
			const answerId = nodeId()
			trace.push({
				id: answerId,
				label: answer,
				kind: "final_answer",
				from: [front]
			})
			sink.stop()
			break
		}
		rejectionCount++
		log.debug(
			{ query, answer, rejectionCount },
			"Answer rejected, looping again"
		)
		if (rejectionCount >= 3) {
			const question =
				"Nem tudom biztosan mit szeretnél, elmondanád pontosabban?"
			await speak(question)
			const reply = prompt(`\n${question}`) ?? ""
			const askId = nodeId()
			trace.push({
				id: askId,
				label: question,
				kind: "ask_user",
				from: [front]
			})
			const replyId = nodeId()
			trace.push({ id: replyId, label: reply, kind: "query", from: [askId] })
			front = replyId
			messages.push({
				role: "user",
				content: reply
			})
			rejectionCount = 0
			continue
		}
		const lastTool = [...messages].reverse().find((m) => m.role === "tool")
		const alreadyActed =
			lastTool &&
			typeof lastTool.content === "string" &&
			/"exitCode":0/.test(lastTool.content)
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
		const callId = nodeId()
		trace.push({
			id: callId,
			label: `${call.function.name}(${call.function.arguments})`,
			kind: "tool_call",
			from: [front]
		})
		let content: string
		try {
			if (call.function.name === "ask_user") {
				await speak(args.question || "Mondj valamit")
				content = prompt(`\n${args.question}`) ?? ""
			} else if (call.function.name === "system_info") {
				content = JSON.stringify(
					await si[args.category as (typeof systemInfoCategories)[number]]()
				)
			} else if (call.function.name === "slang_lookup") {
				content = JSON.stringify(await lookupSlang(args.phrase))
			} else if (call.function.name === "propose_command") {
				content = await runProposedCommand(
					args.command,
					args.explanation,
					speak
				)
			} else if (call.function.name === "brainstorm_options") {
				const candidates: {
					label: string
					action_type: string
					action: string
				}[] = args.candidates
				const candidateIds = candidates.map((c) => {
					const id = nodeId()
					trace.push({
						id,
						label: `${c.label} (${c.action_type})`,
						kind: "brainstorm_candidate",
						from: [callId]
					})
					return id
				})
				const ranked = await rerank(
					args.query,
					candidates.map((c) => `${c.label}\n${c.action}`),
					1
				)
				const winner = candidates[ranked[0]!.index]!
				const runnerUp =
					ranked[1] !== undefined ? candidates[ranked[1].index] : null
				const brainstormWinnerId = nodeId()
				trace.push({
					id: brainstormWinnerId,
					label: winner.label,
					kind: "brainstorm_winner",
					from: [candidateIds[ranked[0]!.index]!],
					score: ranked[0]!.score
				})
				front = brainstormWinnerId
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
				const ranked = await rerank(
					args.query,
					result.map(
						(r: { title: string; description: string }) =>
							`${r.title}\n${r.description}`
					)
				)
				const rankedResults = ranked.map((r) => result[r.index])
				content = await summarize(args.query, rankedResults)
			}
		} catch (err) {
			log.warn({ err, tool: call.function.name }, "Tool call failed")
			content = JSON.stringify({
				error: `${call.function.name} failed: ${err instanceof Error ? err.message : String(err)}`
			})
		}
		const resultId = nodeId()
		trace.push({
			id: resultId,
			label: content,
			kind: "tool_result",
			from: [call.function.name === "brainstorm_options" ? front : callId]
		})
		front = resultId
		messages.push({
			role: "tool",
			tool_call_id: call.id,
			content
		})
	}
}

await Bun.$`mkdir -p flows`.quiet()
const flowPath = `flows/${new Date().toISOString().replace(/[:.]/g, "-")}.mmd`
await Bun.write(flowPath, renderMermaid(trace))
console.log(`\nFlow diagram: ${flowPath}`)

playSound("bell")
process.exit()
