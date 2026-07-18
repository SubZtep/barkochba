// Text-to-speech: speaches synthesizes raw PCM which streams into an
// AudioSink (speakers, …) as it is generated, so speech is audible almost
// immediately instead of after the whole sentence has been synthesized.
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
import { config } from "./config"
import { log } from "./logger"

async function resolveTtsSettings() {
  const { voice } = await config()
  return {
    model: voice?.ttsModel ?? "speaches-ai/Kokoro-82M-v1.0-ONNX-fp16",
    voice: voice?.ttsVoice ?? "af_heart",
    // speachesUrl is a ws:// URL (the STT side); TTS uses plain HTTP on the same server.
    base: (voice?.speachesUrl ?? "ws://localhost:8000").replace(/^ws/, "http")
  }
}

export async function fetchSpeech(
  text: string
): Promise<{ response: Response; voice: string }> {
  const { model, voice, base } = await resolveTtsSettings()
  const res = await fetch(`${base}/v1/audio/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      voice,
      input: text,
      warmupTts: true,
      warmupStt: true,
      onmessage: (msg: any) => {
        if (msg.type === "warmup_done") {
          log.debug("tts: warmup done")
        } else if (msg.type === "warmup_error") {
          log.warn(
            {
              msg
            },
            "tts: warmup error"
          )
        }
      },
      response_format: "pcm" // s16le mono 24kHz (its wav output minus the header)
    })
  })
  if (!res.ok) throw new Error(`TTS failed: ${res.status} ${await res.text()}`)
  if (!res.body) throw new Error("TTS returned no audio")
  return { response: res, voice }
}

// Logs time-to-first-audio, the number the whole streaming design exists for.
async function* logFirstChunk(
  pcm: AsyncIterable<Uint8Array>,
  started: number,
  voice: string
): AsyncIterable<Uint8Array> {
  let first = true
  for await (const chunk of pcm) {
    if (first) {
      first = false
      log.info(
        {
          first_audio_s: +((Date.now() - started) / 1000).toFixed(1)
        },
        "tts: speaking"
      )
    }
    yield chunk
  }
  log.debug(
    {
      synth_s: +((Date.now() - started) / 1000).toFixed(1),
      voice
    },
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
      const { response, voice } = await fetchSpeech(text)
      const utterance = sink.play(
        logFirstChunk(
          response.body as unknown as AsyncIterable<Uint8Array>,
          started,
          voice
        )
      )
      await utterance.consumed // ordering + backpressure; next synthesis may start
      // Wrapped: returning the bare promise would make the queue await
      // audible completion and kill synthesis/playback pipelining.
      return {
        done: utterance.done
      }
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
    const { response } = await fetchSpeech("Hi")
    await response.arrayBuffer() // discard — we only want the model loaded
    log.debug("tts: warmed up")
  } catch (err) {
    log.warn(err, "tts: warmup failed")
  }
}
