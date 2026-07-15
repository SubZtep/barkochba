// The audio frontend abstraction: where user speech comes from and where
// synthesized speech goes. The core pipeline (speaches STT/TTS, LLM) only
// speaks this contract; lib/frontends/* adapt it to real devices — local
// mic/speakers, a Discord voice channel, later a browser AudioWorklet.

/** All PCM crossing the frontend boundary is s16le, mono, 24000 Hz. */
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

export interface AudioFrontend {
  source: AudioSource
  sink: AudioSink
  /** Release processes/connections owned by the frontend. */
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
