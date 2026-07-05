// Voice assistant: speak into the mic, hear the LLM's answer.
//
//   bun talk.ts              converse via the microphone
//   bun talk.ts <audiofile>  feed an audio file as the user's turn (for testing)
//
// Pipeline: mic → speaches STT → Fireworks LLM → speaches TTS → speakers.

import { createChat } from "./lib/llm"
import { createStt } from "./lib/stt"
import { runVoiceLoop } from "./lib/voice"

const stt = createStt({ inputFile: process.argv[2] })

const shutdown = () => {
	stt.stop()
	process.exit(0)
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

await runVoiceLoop(stt, createChat())
process.exit(0)
