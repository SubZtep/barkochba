// The voice-assistant loop shared by talk.ts, voice-game.ts and care.ts:
// listen → send to LLM → speak the reply → listen again.
//
// Replies are spoken sentence by sentence as they stream from the LLM, and the
// next sentence is synthesized while the previous one is still playing.

import type { createChat } from "./llm"
import { log } from "./logger"
import type { Stt } from "./stt"
import { warmupStt } from "./stt"
import { play, synthesize, warmupTts } from "./tts"

type Chat = ReturnType<typeof createChat>

export interface VoiceLoopOptions {
	/** Called after each completed exchange, e.g. to persist it. */
	onTurn?: (you: string, assistant: string) => void
}

export async function runVoiceLoop(
	stt: Stt,
	chat: Chat,
	{ onTurn }: VoiceLoopOptions = {}
) {
	// Load the models server-side while the user draws breath for the first phrase.
	void warmupStt()
	void warmupTts()

	for await (const text of stt.utterances) {
		stt.pause() // half-duplex: don't transcribe our own voice
		log.info({ you: text }, "turn")
		try {
			// Synthesis runs one sentence ahead of playback; playback stays in order.
			let synthChain: Promise<unknown> = Promise.resolve()
			let playChain: Promise<void> = Promise.resolve()
			const sentences: string[] = []
			for await (const sentence of chat.stream(text)) {
				sentences.push(sentence)
				const audio = synthChain.then(() => synthesize(sentence))
				synthChain = audio
				playChain = playChain.then(async () => play(await audio))
			}
			await playChain
			log.info({ assistant: sentences.join(" ") }, "turn")
			onTurn?.(text, sentences.join(" "))
		} catch (err) {
			log.error(err, "turn failed")
		}
		stt.resume()
	}
}
