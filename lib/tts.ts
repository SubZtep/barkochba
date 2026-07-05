// Text-to-speech: speaches synthesizes a WAV, ffplay plays it.
//
// Usage:
//   await speak("Hello there")   // resolves when playback finishes
//
// The TTS model must be downloaded once:
//   curl -X POST localhost:8000/v1/models/speaches-ai/Kokoro-82M-v1.0-ONNX-fp16

import { log } from "./logger"

const MODEL = process.env.TTS_MODEL ?? "speaches-ai/Kokoro-82M-v1.0-ONNX-fp16"
const VOICE = process.env.TTS_VOICE ?? "af_heart"
// SPEACHES_URL is a ws:// URL (the STT side); TTS uses plain HTTP on the same server.
const BASE = (process.env.SPEACHES_URL ?? "ws://localhost:8000").replace(/^ws/, "http")

export async function speak(text: string): Promise<void> {
	const started = Date.now()
	const res = await fetch(`${BASE}/v1/audio/speech`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ model: MODEL, voice: VOICE, input: text, response_format: "wav" })
	})
	if (!res.ok) {
		throw new Error(`TTS failed: ${res.status} ${await res.text()}`)
	}
	const audio = new Uint8Array(await res.arrayBuffer())
	log.info(
		{ synth_s: +((Date.now() - started) / 1000).toFixed(1), voice: VOICE },
		"tts: speech synthesized"
	)

	const player = Bun.spawn(["ffplay", "-autoexit", "-nodisp", "-loglevel", "error", "-"], {
		stdin: "pipe",
		stdout: "ignore",
		stderr: "ignore"
	})
	player.stdin.write(audio)
	player.stdin.end()
	await player.exited
	log.debug({ total_s: +((Date.now() - started) / 1000).toFixed(1) }, "tts: playback finished")
}
