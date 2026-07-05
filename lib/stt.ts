// Speech-to-text: microphone (or audio file) → speaches realtime API → text.
//
// Usage:
//   const stt = createStt({})
//   for await (const text of stt.utterances) console.log(text)
//
// Requires the speaches container running on SPEACHES_URL (default localhost:8000).
// LOG_LEVEL=debug logs every server event.

import { log } from "./logger"

const MODEL = process.env.STT_MODEL ?? "Systran/faster-distil-whisper-small.en"
const LANGUAGE = process.env.STT_LANGUAGE ?? "en"
const BASE = process.env.SPEACHES_URL ?? "ws://localhost:8000"

const SAMPLE_RATE = 24000 // dictated by the OpenAI realtime API spec (pcm16 mono)

export interface Stt {
	/** Final transcripts, one per spoken phrase. Empty/noise segments are filtered out. */
	utterances: AsyncIterable<string>
	/** Stop feeding mic audio to the server (e.g. while TTS is playing, so we don't hear ourselves). */
	pause(): void
	resume(): void
	/** Kill ffmpeg, close the connection and end the utterances iterable. */
	stop(): void
}

export interface SttOptions {
	/** Transcribe this audio file at realtime speed instead of the microphone (useful for testing). */
	inputFile?: string
}

/** Load the STT model server-side so the first real phrase doesn't pay for it. */
export async function warmupStt(): Promise<void> {
	try {
		const httpBase = BASE.replace(/^ws/, "http")
		const form = new FormData()
		form.append("file", new Blob([silenceWav()]), "warmup.wav")
		form.append("model", MODEL)
		const res = await fetch(`${httpBase}/v1/audio/transcriptions`, {
			method: "POST",
			body: form
		})
		if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
		log.debug("stt: warmed up")
	} catch (err) {
		log.warn(err, "stt: warmup failed")
	}
}

// Minimal mono 16-bit PCM WAV of silence.
function silenceWav(seconds = 0.3, rate = 16000): Uint8Array {
	const dataSize = Math.floor(seconds * rate) * 2
	const buf = Buffer.alloc(44 + dataSize)
	buf.write("RIFF", 0)
	buf.writeUInt32LE(36 + dataSize, 4)
	buf.write("WAVEfmt ", 8)
	buf.writeUInt32LE(16, 16) // fmt chunk size
	buf.writeUInt16LE(1, 20) // PCM
	buf.writeUInt16LE(1, 22) // mono
	buf.writeUInt32LE(rate, 24)
	buf.writeUInt32LE(rate * 2, 28) // byte rate
	buf.writeUInt16LE(2, 32) // block align
	buf.writeUInt16LE(16, 34) // bits per sample
	buf.write("data", 36)
	buf.writeUInt32LE(dataSize, 40)
	return buf
}

export function createStt({ inputFile }: SttOptions = {}): Stt {
	// --- transcript queue, consumed via the `utterances` async iterable ---
	const queue: string[] = []
	let ended = false
	let wakeConsumer: (() => void) | undefined

	function push(text: string) {
		queue.push(text)
		wakeConsumer?.()
	}

	async function* utterances() {
		while (true) {
			const next = queue.shift()
			if (next !== undefined) {
				yield next
				continue
			}
			if (ended) return
			await new Promise<void>((resolve) => {
				wakeConsumer = resolve
			})
		}
	}

	// --- audio capture: ffmpeg emits raw pcm16 mono 24kHz on stdout ---
	const ffmpegArgs = [
		"-hide_banner",
		"-loglevel",
		"error",
		...(inputFile
			? ["-re", "-i", inputFile]
			: ["-f", "pulse", "-i", "default"]),
		"-ac",
		"1",
		"-ar",
		String(SAMPLE_RATE),
		"-f",
		"s16le",
		"-"
	]
	const ffmpeg = Bun.spawn(["ffmpeg", ...ffmpegArgs], {
		stdout: "pipe",
		stderr: "pipe"
	})

	let stopping = false
	let paused = false

	// Surface ffmpeg errors (e.g. no mic found), but drop the muxer noise it
	// emits when Ctrl+C signals it alongside us.
	;(async () => {
		for await (const chunk of ffmpeg.stderr) {
			if (stopping) continue
			const text = new TextDecoder().decode(chunk).trim()
			if (text) log.error({ src: "ffmpeg" }, text)
		}
	})()

	// --- speaches realtime session ---
	const url = `${BASE}/v1/realtime?model=${encodeURIComponent(MODEL)}`
	log.info({ url }, "stt: connecting")
	const ws = new WebSocket(url)

	const send = (event: Record<string, unknown>) => {
		if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event))
	}

	ws.onopen = async () => {
		// Transcription-only: stop the server from generating an AI chat response
		// after each phrase, and pick the transcription model/language.
		// turn_detection must be sent complete — partial objects fail validation
		// server-side and are silently dropped.
		send({
			type: "session.update",
			session: {
				turn_detection: {
					type: "server_vad",
					threshold: 0.5,
					prefix_padding_ms: 0, // required by the schema but not configurable server-side
					silence_duration_ms: 500,
					create_response: false
				},
				input_audio_transcription: { model: MODEL, language: LANGUAGE }
			}
		})

		for await (const chunk of ffmpeg.stdout) {
			if (ws.readyState !== WebSocket.OPEN) break
			if (paused) continue
			send({
				type: "input_audio_buffer.append",
				audio: Buffer.from(chunk).toBase64()
			})
		}
		if (inputFile && ws.readyState === WebSocket.OPEN) {
			// Trailing silence so VAD closes the last segment, then give it time to flush.
			send({
				type: "input_audio_buffer.append",
				audio: Buffer.alloc(SAMPLE_RATE * 2).toBase64()
			})
			log.info("stt: end of file — waiting for final transcription")
			setTimeout(stop, 8000)
		}
	}

	let speechStartMs = 0 // position of speech start in the audio stream
	let transcribeStart = 0 // wall clock when transcription began

	ws.onmessage = (e) => {
		const ev = JSON.parse(String(e.data))
		log.debug({ event: ev.type }, "stt: server event")
		switch (ev.type) {
			case "session.created":
				log.info(
					{ model: MODEL, language: LANGUAGE },
					"stt: connected — configuring session"
				)
				break
			case "session.updated":
				log.info(
					inputFile ? `stt: streaming ${inputFile}` : "stt: listening — speak"
				)
				break
			case "input_audio_buffer.speech_started":
				speechStartMs = ev.audio_start_ms ?? 0
				log.info("stt: speech detected — recording")
				break
			case "input_audio_buffer.speech_stopped":
				log.info(
					{ audio_s: +((ev.audio_end_ms - speechStartMs) / 1000).toFixed(1) },
					"stt: pause detected"
				)
				break
			case "input_audio_buffer.committed":
				transcribeStart = Date.now()
				log.info("stt: transcribing")
				break
			case "conversation.item.input_audio_transcription.completed": {
				const took_s = +((Date.now() - transcribeStart) / 1000).toFixed(1)
				const text = (ev.transcript ?? "").trim()
				// VAD can fire on ambient noise, yielding empty transcripts — skip those.
				if (text) {
					log.info({ took_s }, "stt: segment transcribed")
					push(text)
				} else {
					log.info({ took_s }, "stt: empty transcript (noise) — skipped")
				}
				break
			}
			case "error": {
				const msg = ev.error?.message ?? JSON.stringify(ev)
				// The server flags prefix_padding_ms as unsupported even though its own
				// schema requires it in session.update; harmless, so don't surface it.
				if (!msg.includes("prefix_padding_ms"))
					log.error({ src: "server" }, msg)
				break
			}
		}
	}

	ws.onerror = () => {
		log.error(
			{ url },
			"stt: connection failed — is the speaches container running?"
		)
	}
	ws.onclose = stop

	function stop() {
		if (stopping) return
		stopping = true
		ffmpeg.kill()
		if (ws.readyState === WebSocket.OPEN) ws.close()
		ended = true
		wakeConsumer?.()
	}

	return {
		utterances: utterances(),
		pause() {
			paused = true
			// Drop any partly captured audio so it isn't transcribed on resume.
			send({ type: "input_audio_buffer.clear" })
			log.debug("stt: paused")
		},
		resume() {
			paused = false
			log.debug("stt: resumed")
		},
		stop
	}
}
