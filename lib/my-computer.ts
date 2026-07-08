import { join } from "node:path"
import { fetchSpeech } from "./tts"

const soundFile = {
  bell: "333695__khrinx__thin-bell-ding-2.wav",
  magic: "628548__gmlh__icemagic.mp3"
} as const


const MODEL = process.env.TTS_MODEL ?? "speaches-ai/Kokoro-82M-v1.0-ONNX-fp16"
const VOICE = process.env.TTS_VOICE ?? "af_heart"
// SPEACHES_URL is a ws:// URL (the STT side); TTS uses plain HTTP on the same server.
const BASE = (process.env.SPEACHES_URL ?? "ws://localhost:8000").replace(
	/^ws/,
	"http"
)

export function playSound(sound: keyof typeof soundFile) {
  Bun.spawn(["pw-play", join(import.meta.dirname, "..", "assets", soundFile[sound])])
}

export async function saySomething(text: string) {
  const res = await fetchSpeech(text)
  console.log(`TTS: ${text}`, res)
  // const utterance = sink.play(
  //   logFirstChunk(res.body as unknown as AsyncIterable<Uint8Array>, started)
  // )
  // await utterance.consumed // ordering + backpressure; next synthesis may start
}
