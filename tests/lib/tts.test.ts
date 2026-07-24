// Verifies createTts's pipelining contract against a fake sink: utterance N+1
// must start synthesizing (fetching) while N is still audibly playing, and
// utterances must reach the sink in call order.

import { afterEach, expect, test } from "bun:test"
import type { AudioSink } from "../../lib/audio"

// tts.model/tts.voice are mandatory config now (no code-side default), so
// this file needs its own isolated config with them set — same pattern as
// tests/lib/embeddings.test.ts / tests/tools/rerank.test.ts.
process.env.XDG_CONFIG_HOME = `${import.meta.dir}/../../.tmp-test-xdg-config-tts`

const { saveConfig } = await import("../../lib/config")
await saveConfig({
  llm: {
    baseUrl: "http://localhost/v1",
    apiKey: "llm-key",
    model: "test-model"
  },
  tts: { model: "test-tts-model", voice: "test-voice" }
})

const { createTts } = await import("../../lib/tts")

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

test("pipelining: next synthesis starts before previous playback finishes", async () => {
  const fetched: string[] = []
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    fetched.push(JSON.parse(init.body).input)
    return new Response(new Uint8Array([0, 0, 0, 0]))
  }) as unknown as typeof fetch

  const played: string[] = []
  const doneGates = [deferred(), deferred()]
  let playCalls = 0
  const sink: AudioSink = {
    play(pcm) {
      const gate = doneGates[playCalls++]
      const consumed = (async () => {
        for await (const _ of pcm) {
        }
        played.push(fetched[played.length] ?? "?")
      })()
      return {
        consumed,
        done: consumed.then(() => gate?.promise)
      }
    },
    stop() {}
  }

  const { speak } = createTts(sink)
  const p1 = speak("one")
  const p2 = speak("two")

  // With the first utterance consumed but still audibly playing (gate closed),
  // the second must already have been fetched and handed to the sink.
  await Bun.sleep(10)
  expect(fetched).toEqual(["one", "two"])
  expect(played).toEqual(["one", "two"])

  let p1Done = false
  void p1.then(() => {
    p1Done = true
  })
  await Bun.sleep(10)
  expect(p1Done).toBe(false) // speak() resolves on audible completion, not consumption

  doneGates[0]?.resolve()
  await p1
  doneGates[1]?.resolve()
  await p2
})

test("a failed synthesis does not wedge the queue", async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    if (++calls === 1)
      return new Response("boom", {
        status: 500
      })
    return new Response(new Uint8Array([0, 0]))
  }) as unknown as typeof fetch

  let playedChunks = 0
  const sink: AudioSink = {
    play(pcm) {
      const consumed = (async () => {
        for await (const _ of pcm) playedChunks++
      })()
      return {
        consumed,
        done: consumed
      }
    },
    stop() {}
  }

  const { speak } = createTts(sink)
  expect(speak("fails")).rejects.toThrow("TTS failed: 500")
  await speak("works")
  expect(playedChunks).toBeGreaterThan(0)
})
