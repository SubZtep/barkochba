// Real-time speech-to-text against a local speaches server.
//
//   bun stt.ts              transcribe the microphone (PipeWire/Pulse default source)
//   bun stt.ts <audiofile>  transcribe a file at realtime speed (for testing)
//
// Requires the speaches container running on SPEACHES_URL (default localhost:8000).
// Transcripts go to stdout; logs go to stderr (pino-pretty).
// LOG_LEVEL=debug logs every server event.

import { log } from "./lib/logger"

// import pino from "pino";
// import pretty from "pino-pretty";

const MODEL = process.env.STT_MODEL ?? "Systran/faster-distil-whisper-small.en"
const LANGUAGE = process.env.STT_LANGUAGE ?? "en"
const BASE = process.env.SPEACHES_URL ?? "ws://localhost:8000"

// // pino-pretty as a sync stream (not a transport: worker threads are
// // unreliable under Bun, and sync writes survive process.exit).
// const log = pino(
//   { level: process.env.LOG_LEVEL ?? "info", base: undefined },
//   pretty({ destination: 2, sync: true, ignore: "pid,hostname" }),
// );

const inputFile = process.argv[2]

const ffmpegArgs = [
	"-hide_banner",
	"-loglevel",
	"error",
	...(inputFile ? ["-re", "-i", inputFile] : ["-f", "pulse", "-i", "default"]),
	"-ac",
	"1",
	"-ar",
	"24000",
	"-f",
	"s16le",
	"-"
]

const url = `${BASE}/v1/realtime?model=${encodeURIComponent(MODEL)}`

log.info({ url }, "connecting")
const ws = new WebSocket(url)
const ffmpeg = Bun.spawn(["ffmpeg", ...ffmpegArgs], {
	stdout: "pipe",
	stderr: "pipe"
})

let shuttingDown = false

// Surface ffmpeg errors (e.g. no mic found), but drop the muxer noise it
// emits when Ctrl+C signals it alongside us.
;(async () => {
	for await (const chunk of ffmpeg.stderr) {
		if (shuttingDown) continue
		const text = new TextDecoder().decode(chunk).trim()
		if (text) log.error({ src: "ffmpeg" }, text)
	}
})()

ws.onopen = async () => {
	// Transcription-only: stop the server from generating an AI chat response
	// after each phrase, and pick the transcription model/language.
	// turn_detection must be sent complete — partial objects fail validation
	// server-side and are silently dropped.
	ws.send(
		JSON.stringify({
			type: "session.update",
			session: {
				turn_detection: {
					type: "server_vad",
					threshold: 0.5,
					prefix_padding_ms: 0, // required by the schema but not configurable server-side
					silence_duration_ms: 700,
					create_response: false
				},
				input_audio_transcription: { model: MODEL, language: LANGUAGE }
			}
		})
	)

	for await (const chunk of ffmpeg.stdout) {
		if (ws.readyState !== WebSocket.OPEN) break
		ws.send(
			JSON.stringify({
				type: "input_audio_buffer.append",
				audio: Buffer.from(chunk).toBase64()
			})
		)
	}
	if (inputFile && ws.readyState === WebSocket.OPEN) {
		// Trailing silence so VAD closes the last segment, then give it time to flush.
		ws.send(
			JSON.stringify({
				type: "input_audio_buffer.append",
				audio: Buffer.alloc(24000 * 2).toBase64()
			})
		)
		log.info("end of file — waiting for final transcription")
		setTimeout(shutdown, 8000)
	}
}

let deltaSeen = false
let speechStartMs = 0 // position of speech start in the audio stream
let transcribeStart = 0 // wall clock when transcription began

ws.onmessage = (e) => {
	const ev = JSON.parse(String(e.data))
	log.debug({ event: ev.type }, "server event")
	switch (ev.type) {
		case "session.created":
			log.info(
				{ model: MODEL, language: LANGUAGE },
				"connected — configuring session"
			)
			break
		case "session.updated":
			log.info(
				inputFile
					? `streaming ${inputFile}`
					: "listening — speak (Ctrl+C to stop)"
			)
			break
		case "input_audio_buffer.speech_started":
			speechStartMs = ev.audio_start_ms ?? 0
			log.info("speech detected — recording")
			break
		case "input_audio_buffer.speech_stopped":
			log.info(
				{ audio_s: +((ev.audio_end_ms - speechStartMs) / 1000).toFixed(1) },
				"pause detected"
			)
			break
		case "input_audio_buffer.committed":
			transcribeStart = Date.now()
			log.info("transcribing")
			break
		case "conversation.item.input_audio_transcription.delta":
			deltaSeen = true
			process.stdout.write(ev.delta ?? "")
			break
		case "conversation.item.input_audio_transcription.completed": {
			const took_s = +((Date.now() - transcribeStart) / 1000).toFixed(1)
			const text = deltaSeen ? "" : (ev.transcript ?? "").trim()
			// VAD can fire on ambient noise, yielding empty transcripts — skip those.
			if (deltaSeen) process.stdout.write("\n")
			else if (text) process.stdout.write(`${text}\n`)
			if (deltaSeen || text) log.info({ took_s }, "segment transcribed")
			else log.info({ took_s }, "empty transcript (noise) — skipped")
			deltaSeen = false
			break
		}
		case "error": {
			const msg = ev.error?.message ?? JSON.stringify(ev)
			// The server flags prefix_padding_ms as unsupported even though its own
			// schema requires it in session.update; harmless, so don't surface it.
			if (!msg.includes("prefix_padding_ms")) log.error({ src: "server" }, msg)
			break
		}
	}
}

ws.onerror = () => {
	log.error({ url }, "connection failed — is the speaches container running?")
}
ws.onclose = shutdown

function shutdown() {
	shuttingDown = true
	ffmpeg.kill()
	if (ws.readyState === WebSocket.OPEN) ws.close()
	process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
