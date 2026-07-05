// LLM chat with conversation history, via the OpenAI SDK pointed at Fireworks.
//
// Usage:
//   const chat = createChat()
//   const reply = await chat.ask("hello")

import OpenAI from "openai"
import { log } from "./logger"

const MODEL = process.env.LLM_MODEL ?? "accounts/fireworks/models/minimax-m3"

// Replies are read aloud by TTS, so keep them short and speakable.
const VOICE_SYSTEM = `You are a friendly voice assistant. Your replies are read aloud
by a text-to-speech engine, so answer in one to three short conversational sentences
of plain spoken text — no markdown, no lists, no emoji.`

export function createChat(system: string = VOICE_SYSTEM) {
	const client = new OpenAI({
		apiKey: process.env.FIREWORKS_API_KEY,
		baseURL: "https://api.fireworks.ai/inference/v1"
	})
	const messages: OpenAI.ChatCompletionMessageParam[] = [
		{ role: "system", content: system }
	]

	async function ask(userText: string): Promise<string> {
		messages.push({ role: "user", content: userText })
		const started = Date.now()
		const res = await client.chat.completions.create({
			model: MODEL,
			max_tokens: 1000,
			messages
		})
		// Reasoning models may prefix their answer with a <think> block — drop it.
		const reply = (res.choices[0]?.message.content ?? "")
			.replace(/<think>[\s\S]*?<\/think>/, "")
			.trim()
		if (!reply) throw new Error("LLM returned no content")
		messages.push({ role: "assistant", content: reply })
		log.info({ took_s: +((Date.now() - started) / 1000).toFixed(1), model: MODEL }, "llm: reply")
		return reply
	}

	return { ask }
}
