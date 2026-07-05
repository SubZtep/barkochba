// Voice assistant in a Discord voice channel: the bot joins the configured
// channel, listens to the configured user, and speaks the LLM's answers.
//
//   bun discord.ts
//
// Pipeline: Discord voice → speaches STT → Fireworks LLM → speaches TTS → Discord voice.
// Env: DISCORD_TOKEN, DISCORD_GUILD_ID, DISCORD_CHANNEL_ID, DISCORD_USER_ID.

import { createDiscordFrontend } from "./lib/frontends/discord"
import { createChat } from "./lib/llm"
import { createStt } from "./lib/stt"
import { createTts } from "./lib/tts"
import { runVoiceLoop } from "./lib/voice"

const frontend = await createDiscordFrontend()
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
