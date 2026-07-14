// Voice assistant: speak into the mic, hear the LLM's answer.
//
//   bun talk.ts              converse via the microphone
//   bun talk.ts <audiofile>  feed an audio file as the user's turn (for testing)
//
// Pipeline: mic → speaches STT → Fireworks LLM → speaches TTS → speakers.

import { createLocalFrontend } from "./lib/frontends/local"
import { createChat } from "./lib/llm"
import { createStt } from "./lib/stt"
import { createTts } from "./lib/tts"
import { runVoiceLoop } from "./lib/voice"

const frontend = createLocalFrontend({ inputFile: process.argv[2] })
const stt = createStt({ source: frontend.source })
const { speak } = createTts(frontend.sink)

const shutdown = () => {
  stt.stop()
  frontend.stop()
  process.exit(0)
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

await runVoiceLoop(stt, createChat(), { speak })
process.exit(0)
