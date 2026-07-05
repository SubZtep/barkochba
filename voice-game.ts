// Barkochba (Twenty Questions) by voice: think of something, answer the
// guesser's questions out loud with yes / no / sometimes / unknown.
//
//   bun voice-game.ts        play via the microphone
//
// Say anything to start — the guesser asks its first question.

import { createLocalFrontend } from "./lib/frontends/local"
import { createChat } from "./lib/llm"
import { createStt } from "./lib/stt"
import { createTts } from "./lib/tts"
import { runVoiceLoop } from "./lib/voice"

const GUESSER_SYSTEM = `You are the GUESSER in a spoken game of Twenty Questions (barkochba).
The user has thought of one specific thing — an object, animal, person, place, or concept.
Identify it by asking yes/no questions, then naming it.

RULES
- You have a budget of 20 questions total. Track the count yourself and mention it
  now and then ("Question seven: ...").
- Ask exactly ONE yes/no question per turn.
- The user answers by voice with yes, no, sometimes, or unknown. Speech recognition
  may garble their answer — interpret it charitably, and if it is unintelligible,
  ask them to repeat it (that costs no question).
- You may guess the thing on any turn. A wrong guess costs one question.
- When the user confirms a guess, celebrate briefly and offer a new round.

STYLE
Your words are read aloud by text-to-speech: one short plain sentence per turn,
no markdown, no lists. Open broad and narrow down; never re-ask what an earlier
answer already settled; commit to a guess when the field is narrow or budget is low.

The user's first utterance just means they are ready — respond with question one.`

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

await runVoiceLoop(stt, createChat(GUESSER_SYSTEM), { speak })
process.exit(0)
