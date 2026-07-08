// Text-to-speech: speaches synthesizes raw PCM which streams into an
// AudioSink (speakers, Discord, ...) as it is generated, so speech is audible
// almost immediately instead of after the whole sentence has been synthesized.
//
// Usage:
//   const { speak } = createTts(sink)
//   await speak("Hello there")   // resolves when the audio has finished playing
//
// Concurrent speak() calls are safe: synthesis runs one utterance at a time
// (the CPU can't do two at realtime speed anyway) and playback stays in call
// order, so callers can fire sentences as fast as they arrive.
//
// The TTS model must be downloaded once:
//   curl -X POST localhost:8000/v1/models/speaches-ai/Kokoro-82M-v1.0-ONNX-fp16

import type { AudioSink } from "./audio"
import { log } from "./logger"
import { warmupStt } from "./stt"

const MODEL = process.env.TTS_MODEL ?? "speaches-ai/Kokoro-82M-v1.0-ONNX-fp16"
const VOICE = process.env.TTS_VOICE ?? "af_heart"
// SPEACHES_URL is a ws:// URL (the STT side); TTS uses plain HTTP on the same server.
const BASE = (process.env.SPEACHES_URL ?? "ws://localhost:8000").replace(
	/^ws/,
	"http"
)

export async function fetchSpeech(text: string): Promise<Response> {
	const res = await fetch(`${BASE}/v1/audio/speech`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model: MODEL,
			voice: VOICE,
			input: text,
			warmupTts: true,
			warmupStt: true,
			onmessage: (msg: any) => {
				if (msg.type === "warmup_done") {
					log.debug("tts: warmup done")
				} else if (msg.type === "warmup_error") {
					log.warn({ msg }, "tts: warmup error")
				}
			},
			response_format: "pcm" // s16le mono 24kHz (its wav output minus the header)
		})
	})
	if (!res.ok) throw new Error(`TTS failed: ${res.status} ${await res.text()}`)
	if (!res.body) throw new Error("TTS returned no audio")
	return res
}

// Logs time-to-first-audio, the number the whole streaming design exists for.
async function* logFirstChunk(
	pcm: AsyncIterable<Uint8Array>,
	started: number
): AsyncIterable<Uint8Array> {
	let first = true
	for await (const chunk of pcm) {
		if (first) {
			first = false
			log.info(
				{ first_audio_s: +((Date.now() - started) / 1000).toFixed(1) },
				"tts: speaking"
			)
		}
		yield chunk
	}
	log.debug(
		{ synth_s: +((Date.now() - started) / 1000).toFixed(1), voice: VOICE },
		"tts: utterance synthesized"
	)
}

export function createTts(sink: AudioSink) {
	// Serializes synthesis+consumption across speak() calls so utterances never
	// interleave in the sink and the server synthesizes one at a time.
	let queue: Promise<unknown> = Promise.resolve()

	function speak(text: string): Promise<void> {
		const step = queue.then(async () => {
			const started = Date.now()
			const res = await fetchSpeech(text)
			const utterance = sink.play(
				logFirstChunk(res.body as unknown as AsyncIterable<Uint8Array>, started)
			)
			await utterance.consumed // ordering + backpressure; next synthesis may start
			// Wrapped: returning the bare promise would make the queue await
			// audible completion and kill synthesis/playback pipelining.
			return { done: utterance.done }
		})
		queue = step.catch(() => {})
		// Resolve when the audio is audibly done, not when it was handed to the
		// sink; the next queued utterance starts synthesizing without waiting.
		return step.then(({ done }) => done)
	}

	return { speak }
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
