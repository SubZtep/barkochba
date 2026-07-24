import { afterAll, expect, test } from "bun:test"
import { checkModelAvailability } from "../../lib/model-check"

// A tiny stand-in OpenAI-compatible server: chat completions succeed only
// for "known-model" (mirrors a real provider rejecting an unserved model),
// and /models lists only "known-tts-model" (mirrors the tts/stt fallback
// path, which still uses the list endpoint).
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === "/chat/completions") {
      const body = (await req.json()) as { model: string }
      if (body.model === "known-model") {
        return Response.json({
          id: "x",
          choices: [{ message: { role: "assistant", content: "hi" } }]
        })
      }
      return new Response("model not found", { status: 404 })
    }
    if (url.pathname === "/models") {
      return Response.json({
        data: [{ id: "known-tts-model", object: "model" }]
      })
    }
    return new Response("not found", { status: 404 })
  }
})
const baseUrl = `http://localhost:${server.port}`

afterAll(() => {
  server.stop()
})

test("chat model: available when the completion request succeeds", async () => {
  const ok = await checkModelAvailability({
    id: "known-model",
    task: "chat",
    baseUrl
  })
  expect(ok).toBe(true)
})

test("chat model: not available when the provider rejects the model id (even if absent from /models)", async () => {
  const ok = await checkModelAvailability({
    id: "unlisted-but-should-still-be-tested",
    task: "chat",
    baseUrl
  })
  expect(ok).toBe(false)
})

test("tts model: falls back to the /models list", async () => {
  const ok = await checkModelAvailability({
    id: "known-tts-model",
    task: "text-to-speech",
    baseUrl
  })
  expect(ok).toBe(true)
})

test("tts model: not available when absent from /models", async () => {
  const ok = await checkModelAvailability({
    id: "missing-tts-model",
    task: "text-to-speech",
    baseUrl
  })
  expect(ok).toBe(false)
})
