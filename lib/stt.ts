// Speech-to-text: an AudioSource (mic, …) → speaches realtime API → text.
//
// Usage:
//   const stt = await createStt({ source: createLocalSource() })
//   for await (const text of stt.utterances) console.log(text)
//
// Requires the speaches container running on speachesUrl (config.json, default localhost:8000).
// LOG_LEVEL=debug logs every server event.

import type { AudioSource } from "./audio"
import { createAsyncQueue, SAMPLE_RATE } from "./audio"
import { config } from "./config"
import { getLanguage } from "./i18n"
import { log } from "./logger"

async function resolveSttSettings() {
  const { stt } = await config()
  if (!stt?.model) {
    throw new Error("No STT model configured — set stt.model in config.json")
  }
  return {
    model: stt.model,
    language: stt.language ?? getLanguage(),
    base: stt.speachesUrl ?? "ws://localhost:8000"
  }
}

export interface Stt {
  /** Final transcripts, one per spoken phrase. Empty/noise segments are filtered out. */
  utterances: AsyncIterable<string>
  /** Remove and return transcripts that are queued but not yet consumed. */
  drainPending(): string[]
  /** Stop feeding source audio to the server (e.g. while TTS is playing, so we don't hear ourselves). */
  pause(): void
  resume(): void
  /** Stop the source, close the connection and end the utterances iterable. */
  stop(): void
}

/**
 * Where the server currently is with the user's speech: waiting for it,
 * hearing it, or turning a finished phrase into text.
 */
export type SttState = "listening" | "recording" | "transcribing"

export interface SttOptions {
  /** Where the user's speech comes from (pcm16 mono 24kHz). */
  source: AudioSource
  /** Observe transcription progress, e.g. to show recording/transcribing in a UI. */
  onState?: (state: SttState) => void
}

export async function createStt({ source, onState }: SttOptions): Promise<Stt> {
  const { model, language, base } = await resolveSttSettings()

  // Final transcripts, consumed via the `utterances` async iterable.
  const transcripts = createAsyncQueue<string>()

  let stopping = false
  // Half-duplex has two mute reasons: the consumer asked (TTS is playing) and
  // a segment is being transcribed (speech now would only queue behind the
  // answer). Either one silences the mic.
  let pausedByUser = false
  let transcribing = false

  // --- speaches realtime session ---
  const url = `${base}/v1/realtime?model=${encodeURIComponent(model)}`
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
        input_audio_transcription: {
          model,
          language
        }
      }
    })

    for await (const chunk of source.chunks) {
      if (ws.readyState !== WebSocket.OPEN) break
      if (pausedByUser || transcribing) continue
      send({
        type: "input_audio_buffer.append",
        audio: Buffer.from(chunk).toBase64()
      })
    }
    // A live source (mic) only ends via stop(); a finite one (file) ends on
    // its own — append trailing silence so VAD closes the last segment, then
    // give it time to flush. 3s: the server's VAD needs well over
    // silence_duration_ms of tail audio before it emits speech_stopped.
    if (!stopping && ws.readyState === WebSocket.OPEN) {
      send({
        type: "input_audio_buffer.append",
        audio: Buffer.alloc(SAMPLE_RATE * 2 * 3).toBase64()
      })
      log.info("stt: end of input — waiting for final transcription")
      setTimeout(stop, 8000)
    }
  }

  let speechStartMs = 0 // position of speech start in the audio stream
  let transcribeStart = 0 // wall clock when transcription began

  ws.onmessage = (e) => {
    const ev = JSON.parse(String(e.data))
    log.debug(
      {
        event: ev.type
      },
      "stt: server event"
    )
    switch (ev.type) {
      case "session.created":
        log.info(
          {
            model,
            language
          },
          "stt: connected — configuring session"
        )
        break
      case "session.updated":
        log.info("stt: listening — speak")
        onState?.("listening")
        break
      case "input_audio_buffer.speech_started":
        speechStartMs = ev.audio_start_ms ?? 0
        log.info("stt: speech detected — recording")
        onState?.("recording")
        break
      case "input_audio_buffer.speech_stopped":
        log.info(
          {
            audio_s: +((ev.audio_end_ms - speechStartMs) / 1000).toFixed(1)
          },
          "stt: pause detected"
        )
        break
      case "input_audio_buffer.committed":
        transcribeStart = Date.now()
        // Mute the mic until the transcript lands: on a slow model the user
        // tends to repeat themselves, and those repeats would queue up as
        // extra turns. Clear so a partly captured phrase doesn't linger.
        transcribing = true
        send({
          type: "input_audio_buffer.clear"
        })
        log.info("stt: transcribing")
        onState?.("transcribing")
        break
      case "conversation.item.input_audio_transcription.completed": {
        const took_s = +((Date.now() - transcribeStart) / 1000).toFixed(1)
        const text = (ev.transcript ?? "").trim()
        // Un-mute here rather than in resume(): consumers that never call
        // pause() must keep hearing the mic. A pause()ing consumer reacts to
        // the push before the next mic chunk can slip through.
        transcribing = false
        onState?.("listening")
        // VAD can fire on ambient noise, yielding empty transcripts — skip those.
        if (text) {
          log.info(
            {
              took_s
            },
            "stt: segment transcribed"
          )
          transcripts.push(text)
        } else {
          log.info(
            {
              took_s
            },
            "stt: empty transcript (noise) — skipped"
          )
        }
        break
      }
      case "error": {
        const msg = ev.error?.message ?? JSON.stringify(ev)
        // The server flags prefix_padding_ms as unsupported even though its own
        // schema requires it in session.update; harmless, so don't surface it.
        if (!msg.includes("prefix_padding_ms"))
          log.error(
            {
              src: "server"
            },
            msg
          )
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
    source.stop()
    if (ws.readyState === WebSocket.OPEN) ws.close()
    transcripts.end()
  }

  return {
    utterances: transcripts,
    drainPending() {
      return transcripts.drain()
    },
    pause() {
      pausedByUser = true
      // Drop any partly captured audio so it isn't transcribed on resume.
      send({
        type: "input_audio_buffer.clear"
      })
      log.debug("stt: paused")
    },
    resume() {
      pausedByUser = false
      onState?.("listening")
      log.debug("stt: resumed")
    },
    stop
  }
}
