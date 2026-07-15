// Local audio frontend: ffmpeg captures the default PulseAudio/PipeWire mic
// (or replays a file at realtime speed for testing), one long-lived ffplay
// process plays synthesized speech on the speakers.

import type { AudioFrontend, AudioSink, AudioSource } from "../audio"
import { readStream, SAMPLE_RATE } from "../audio"
import { log } from "../logger"

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

export function createLocalFrontend(
  options: LocalSourceOptions = {}
): AudioFrontend {
  const source = createLocalSource(options)
  const sink = createLocalSink()
  return {
    source,
    sink,
    stop() {
      source.stop()
      sink.stop()
    }
  }
}
