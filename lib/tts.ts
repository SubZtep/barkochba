// Text-to-speech: speaches synthesizes raw PCM which streams into one
// long-lived ffplay process as it is generated, so speech is audible almost
// immediately instead of after the whole sentence has been synthesized.
//
// Usage:
//   await speak("Hello there")   // resolves when the audio has finished playing
//
// Concurrent speak() calls are safe: synthesis runs one utterance at a time
// (the CPU can't do two at realtime speed anyway) and playback stays in call
// order, so callers can fire sentences as fast as they arrive.
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

const SAMPLE_RATE = 24000 // speaches pcm output is s16le mono 24kHz (its wav minus the header)
const SINK_LATENCY_MS = 200 // estimated delay between writing audio and hearing it

// --- audio sink: one ffplay playing a raw PCM stream for the process lifetime ---

let sink: Bun.Subprocess<"pipe", "ignore", "ignore"> | undefined

function getSink() {
	if (!sink || sink.exitCode !== null) {
		sink = Bun.spawn(
			[
				"ffplay",
				"-hide_banner",
				"-loglevel",
				"error",
				"-nodisp",
				"-autoexit",
				"-f",
				"s16le",
				"-ar",
				String(SAMPLE_RATE),
				"-ac",
				"1",
				"-"
			],
			{ stdin: "pipe", stdout: "ignore", stderr: "ignore" }
		)
	}
	return sink
}

// Wall-clock ms when the sink runs out of queued audio. Writes race ahead of
// playback (the pipe buffers ~1.5s), so this clock — not write completion —
// tells us when the speakers actually go quiet.
let audioEndsAt = 0

async function fetchSpeech(text: string): Promise<Response> {
	const res = await fetch(`${BASE}/v1/audio/speech`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model: MODEL,
			voice: VOICE,
			input: text,
			response_format: "pcm"
		})
	})
	if (!res.ok) throw new Error(`TTS failed: ${res.status} ${await res.text()}`)
	if (!res.body) throw new Error("TTS returned no audio")
	return res
}

// Serializes synthesis+writing across speak() calls so utterances never
// interleave in the sink and the server synthesizes one at a time.
let queue: Promise<unknown> = Promise.resolve()

export function speak(text: string): Promise<void> {
	const written = queue.then(async () => {
		const started = Date.now()
		const res = await fetchSpeech(text)
		const stdin = getSink().stdin
		let bytes = 0
		for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
			if (bytes === 0) {
				log.info(
					{ first_audio_s: +((Date.now() - started) / 1000).toFixed(1) },
					"tts: speaking"
				)
			}
			stdin.write(chunk)
			await stdin.flush()
			bytes += chunk.byteLength
			audioEndsAt =
				Math.max(audioEndsAt, Date.now() + SINK_LATENCY_MS) +
				(chunk.byteLength / (SAMPLE_RATE * 2)) * 1000
		}
		log.debug(
			{ synth_s: +((Date.now() - started) / 1000).toFixed(1), voice: VOICE },
			"tts: utterance synthesized"
		)
	})
	queue = written.catch(() => {})
	// Resolve when the audio is audibly done, not when it was handed to the
	// sink; the next queued utterance starts synthesizing without waiting.
	return written.then(async () => {
		const remaining = audioEndsAt - Date.now()
		if (remaining > 0) await Bun.sleep(remaining)
	})
}

/** Load the TTS model server-side so the first real reply doesn't pay for it. */
export async function warmupTts(): Promise<void> {
	try {
		const res = await fetchSpeech("Hi")
		await res.arrayBuffer() // discard — we only want the model loaded
		log.debug("tts: warmed up")
	} catch (err) {
		log.warn(err, "tts: warmup failed")
	}
}
