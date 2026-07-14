// Self-care companion (early skeleton of the README TODO app): a supportive
// voice chat that remembers past sessions via lib/brain.ts. Tell it stories —
// what happened, how you behaved, how it turned out — and it keeps them.
//
//   bun care.ts              converse via the microphone
//
// Memory lives in brain.sqlite (override with BRAIN_DB).

import { recall, remember } from "./lib/brain"
import { createLocalFrontend } from "./lib/frontends/local"
import { createChat } from "./lib/llm"
import { createStt } from "./lib/stt"
import { createTts } from "./lib/tts"
import { runVoiceLoop } from "./lib/voice"

const CARE_SYSTEM = `You are a warm, grounded self-care companion. The user tells you
stories from their life — situations, how they behaved, and how things turned out.

- Listen first. Reflect back what you heard before offering anything.
- Be curious about behaviour and outcome: what they did, what followed, how it felt.
- Draw gentle connections to things they told you in earlier conversations when relevant.
- Never lecture, diagnose, or moralize. Suggest at most one small idea at a time, as an offer.

Your words are read aloud by text-to-speech: one to three short plain sentences,
no markdown, no lists, no emoji.`

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

await runVoiceLoop(stt, createChat(CARE_SYSTEM, recall()), {
  speak,
  onTurn: remember
})
process.exit(0)
