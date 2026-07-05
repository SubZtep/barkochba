// Text-to-speech: speaches synthesizes a WAV, ffplay plays it.
//
// Usage:
//   await speak("Hello there")            // synthesize + play, resolves when done
//   const wav = await synthesize("Hi")    // or do the two steps separately,
//   await play(wav)                       // e.g. to synthesize ahead while playing
//
// The TTS model must be downloaded once:
//   curl -X POST localhost:8000/v1/models/speaches-ai/Kokoro-82M-v1.0-ONNX-fp16

import { log } from "./logger"

const MODEL = process.env.TTS_MODEL ?? "speaches-ai/Kokoro-82M-v1.0-ONNX-fp16"
const VOICE = process.env.TTS_VOICE ?? "af_heart"
// SPEACHES_URL is a ws:// URL (the STT side); TTS uses plain HTTP on the same server.
const BASE = (process.env.SPEACHES_URL ?? "ws://localhost:8000").replace(
	/^ws/,
	"http"
)

export async function synthesize(text: string): Promise<Uint8Array> {
	const started = Date.now()
	const res = await fetch(`${BASE}/v1/audio/speech`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model: MODEL,
			voice: VOICE,
			input: text,
			response_format: "wav"
		})
	})
	if (!res.ok) {
		throw new Error(`TTS failed: ${res.status} ${await res.text()}`)
	}
	const audio = new Uint8Array(await res.arrayBuffer())
	log.info(
		{ synth_s: +((Date.now() - started) / 1000).toFixed(1), voice: VOICE },
		"tts: speech synthesized"
	)
	return audio
}

export async function play(audio: Uint8Array): Promise<void> {
	const player = Bun.spawn(
		["ffplay", "-autoexit", "-nodisp", "-loglevel", "error", "-"],
		{
			stdin: "pipe",
			stdout: "ignore",
			stderr: "ignore"
		}
	)
	player.stdin.write(audio)
	player.stdin.end()
	await player.exited
}

export async function speak(text: string): Promise<void> {
	await play(await synthesize(text))
}

/** Load the TTS model server-side so the first real reply doesn't pay for it. */
export async function warmupTts(): Promise<void> {
	try {
		await synthesize("Hi")
		log.debug("tts: warmed up")
	} catch (err) {
		log.warn(err, "tts: warmup failed")
	}
}
