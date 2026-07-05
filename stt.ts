// Real-time speech-to-text CLI.
//
//   bun stt.ts              transcribe the microphone (PipeWire/Pulse default source)
//   bun stt.ts <audiofile>  transcribe a file at realtime speed (for testing)
//
// Transcripts go to stdout; logs go to stderr (LOG_LEVEL=error for transcript-only).

import { createStt } from "./lib/stt"

const stt = createStt({ inputFile: process.argv[2] })

const shutdown = () => {
	stt.stop()
	process.exit(0)
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

for await (const text of stt.utterances) {
	console.log(text)
}
process.exit(0)
