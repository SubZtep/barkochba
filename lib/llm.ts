// LLM chat with conversation history, via the OpenAI SDK pointed at Fireworks.
//
// Usage:
//   const chat = createChat()
//   const reply = await chat.ask("hello")
//   for await (const sentence of chat.stream("hello")) await speak(sentence)

import OpenAI from "openai"
import { log } from "./logger"

const MODEL = process.env.LLM_MODEL ?? "accounts/fireworks/models/minimax-m3"

// Replies are read aloud by TTS, so keep them short and speakable.
const VOICE_SYSTEM = `You are a friendly voice assistant. Your replies are read aloud
by a text-to-speech engine, so answer in one to three short conversational sentences
of plain spoken text — no markdown, no lists, no emoji.`

export type ChatMessage = { role: "user" | "assistant"; content: string }

// Reasoning models may wrap deliberation in <think> blocks — never speak those.
const stripThink = (text: string) =>
	text.replace(/<think>[\s\S]*?<\/think>/g, "").trim()

// Split completed sentences off the front of a streaming buffer.
// Returns the sentences and whatever incomplete tail remains.
function splitSentences(buffer: string): [string[], string] {
	const sentences: string[] = []
	const boundary = /[.!?…]+["')\]]*\s+/g
	let consumed = 0
	for (let m = boundary.exec(buffer); m; m = boundary.exec(buffer)) {
		sentences.push(buffer.slice(consumed, boundary.lastIndex).trim())
		consumed = boundary.lastIndex
	}
	return [sentences.filter(Boolean), buffer.slice(consumed)]
}

export function createChat(
	system: string = VOICE_SYSTEM,
	history: ChatMessage[] = []
) {
	const client = new OpenAI({
		apiKey: process.env.FIREWORKS_API_KEY,
		baseURL: "https://api.fireworks.ai/inference/v1"
	})
	const messages: OpenAI.ChatCompletionMessageParam[] = [
		{ role: "system", content: system },
		...history
	]

	async function ask(userText: string): Promise<string> {
		messages.push({ role: "user", content: userText })
		const started = Date.now()
		const res = await client.chat.completions.create({
			model: MODEL,
			max_tokens: 1000,
			messages
		})
		const reply = stripThink(res.choices[0]?.message.content ?? "")
		if (!reply) throw new Error("LLM returned no content")
		messages.push({ role: "assistant", content: reply })
		log.info(
			{ took_s: +((Date.now() - started) / 1000).toFixed(1), model: MODEL },
			"llm: reply"
		)
		return reply
	}

	// Yields the reply sentence by sentence as it streams in, so TTS can start
	// speaking before the model has finished. History gets the full reply.
	async function* stream(userText: string): AsyncGenerator<string> {
		messages.push({ role: "user", content: userText })
		const started = Date.now()
		const res = await client.chat.completions.create({
			model: MODEL,
			max_tokens: 1000,
			messages,
			stream: true
		})

		// `pending` holds raw stream text (may contain <think> tags, possibly
		// split across chunks); `speakable` holds cleaned text awaiting a
		// sentence boundary.
		let pending = ""
		let speakable = ""
		let thinking = false
		const spoken: string[] = []

		// Length of a partial "<think>" opener at the end of the buffer, so we
		// never emit half a tag.
		const partialTag = (text: string) => {
			for (let i = Math.min(6, text.length); i > 0; i--) {
				if (text.endsWith("<think>".slice(0, i))) return i
			}
			return 0
		}

		for await (const chunk of res) {
			pending += chunk.choices[0]?.delta.content ?? ""
			while (true) {
				if (thinking) {
					const end = pending.indexOf("</think>")
					if (end === -1) {
						pending = "" // discard deliberation as it streams
						break
					}
					pending = pending.slice(end + "</think>".length)
					thinking = false
				} else {
					const start = pending.indexOf("<think>")
					if (start === -1) {
						const hold = partialTag(pending)
						speakable += pending.slice(0, pending.length - hold)
						pending = pending.slice(pending.length - hold)
						break
					}
					speakable += pending.slice(0, start)
					pending = pending.slice(start + "<think>".length)
					thinking = true
				}
			}
			const [sentences, rest] = splitSentences(speakable)
			speakable = rest
			for (const sentence of sentences) {
				if (spoken.length === 0) {
					log.info(
						{ first_sentence_s: +((Date.now() - started) / 1000).toFixed(1) },
						"llm: streaming reply"
					)
				}
				spoken.push(sentence)
				yield sentence
			}
		}
		const tail = (speakable + (thinking ? "" : pending)).trim()
		if (tail) {
			spoken.push(tail)
			yield tail
		}

		const reply = spoken.join(" ")
		if (!reply) throw new Error("LLM returned no content")
		messages.push({ role: "assistant", content: reply })
		log.info(
			{ took_s: +((Date.now() - started) / 1000).toFixed(1), model: MODEL },
			"llm: reply"
		)
	}

	return { ask, stream }
}
