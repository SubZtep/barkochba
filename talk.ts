// Voice assistant: speak into the mic, hear the LLM's answer.
//
//   bun talk.ts              converse via the microphone
//   bun talk.ts <audiofile>  feed an audio file as the user's turn (for testing)
//
// Pipeline: mic → speaches STT → Fireworks LLM → speaches TTS → speakers.

import { createChat } from "./lib/llm"
import { log } from "./lib/logger"
import { createStt } from "./lib/stt"
import { speak } from "./lib/tts"

const stt = createStt({ inputFile: process.argv[2] })
const chat = createChat()

const shutdown = () => {
	stt.stop()
	process.exit(0)
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

for await (const text of stt.utterances) {
	stt.pause() // half-duplex: don't transcribe our own voice
	log.info({ you: text }, "turn")
	try {
		const reply = await chat.ask(text)
		log.info({ assistant: reply }, "turn")
		await speak(reply)
	} catch (err) {
		log.error(err, "turn failed")
	}
	stt.resume()
}
process.exit(0)
