// Audio I/O: where user speech comes from and where synthesized speech
// goes. STT/TTS only depend on the AudioSource/AudioSink shapes; capture
// and playback here go through ffmpeg/ffplay against the default
// PulseAudio/PipeWire mic and speakers.

import { log } from "./logger"

/** All PCM crossing the audio boundary is s16le, mono, 24000 Hz. */
export const SAMPLE_RATE = 24000

/** Drain a ReadableStream as an async iterable (Bun subprocess pipes, fetch bodies, …). */
export async function* readStream(
  stream: ReadableStream<Uint8Array>
): AsyncIterable<Uint8Array> {
  const reader = stream.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return
      if (value) yield value
    }
  } finally {
    reader.releaseLock()
  }
}

export interface AudioSource {
  /** PCM16 mono 24kHz chunks from the user's microphone (or equivalent). */
  chunks: AsyncIterable<Uint8Array>
  /** Stop capturing and end the chunks iterable. */
  stop(): void
}

export interface AudioSink {
  /**
   * Play one utterance, consuming `pcm` as it is synthesized.
   * `consumed` resolves when the input has been fully read (the next
   * utterance may start synthesizing); `done` when the audio has audibly
   * finished playing. Utterances play back in call order.
   */
  play(pcm: AsyncIterable<Uint8Array>): {
    consumed: Promise<void>
    done: Promise<void>
  }
  stop(): void
}

/**
 * Unbounded push queue drained by a single async-iterating consumer.
 * push() after end() is a no-op.
 */
export function createAsyncQueue<T>() {
  const items: T[] = []
  let ended = false
  let wakeConsumer: (() => void) | undefined

  return {
    push(item: T) {
      if (ended) return
      items.push(item)
      wakeConsumer?.()
    },
    end() {
      ended = true
      wakeConsumer?.()
    },
    /** Remove and return everything queued but not yet consumed. */
    drain() {
      return items.splice(0)
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        const next = items.shift()
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
  }
}

const SINK_LATENCY_MS = 200 // estimated delay between writing audio and hearing it

export interface LocalSourceOptions {
  /** Stream this audio file at realtime speed instead of the microphone (useful for testing). */
  inputFile?: string
}

export function createLocalSource({
  inputFile
}: LocalSourceOptions = {}): AudioSource {
  // ffmpeg emits raw pcm16 mono 24kHz on stdout
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

  // Surface ffmpeg errors (e.g. no mic found), but drop the muxer noise it
  // emits when Ctrl+C signals it alongside us.
  ;(async () => {
    for await (const chunk of readStream(ffmpeg.stderr)) {
      if (stopping) continue
      const text = new TextDecoder().decode(chunk).trim()
      if (text)
        log.error(
          {
            src: "ffmpeg"
          },
          text
        )
    }
  })()

  return {
    chunks: readStream(ffmpeg.stdout),
    stop() {
      stopping = true
      ffmpeg.kill()
    }
  }
}

export function createLocalSink(): AudioSink {
  // One ffplay playing a raw PCM stream for the process lifetime.
  let ffplay: Bun.Subprocess<"pipe", "ignore", "ignore"> | undefined

  function getFfplay() {
    if (!ffplay || ffplay.exitCode !== null) {
      ffplay = Bun.spawn(
        [
          "ffplay",
          "-hide_banner",
          "-loglevel",
          "error",
          "-nodisp",
          "-autoexit",
          "-f",
          "s16le",
          "-sample_rate",
          String(SAMPLE_RATE),
          "-ch_layout",
          "mono",
          "-"
        ],
        {
          stdin: "pipe",
          stdout: "ignore",
          stderr: "ignore"
        }
      )
    }
    return ffplay
  }

  // Wall-clock ms when the sink runs out of queued audio. Writes race ahead of
  // playback (the pipe buffers ~1.5s), so this clock — not write completion —
  // tells us when the speakers actually go quiet.
  let audioEndsAt = 0

  return {
    play(pcm) {
      const consumed = (async () => {
        const stdin = getFfplay().stdin
        for await (const chunk of pcm) {
          stdin.write(chunk)
          await stdin.flush()
          audioEndsAt =
            Math.max(audioEndsAt, Date.now() + SINK_LATENCY_MS) +
            (chunk.byteLength / (SAMPLE_RATE * 2)) * 1000
        }
      })()
      const done = consumed.then(async () => {
        const remaining = audioEndsAt - Date.now()
        if (remaining > 0) await Bun.sleep(remaining)
      })
      return {
        consumed,
        done
      }
    },
    stop() {
      ffplay?.kill()
    }
  }
}
