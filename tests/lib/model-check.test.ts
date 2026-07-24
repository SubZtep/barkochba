import { afterAll, expect, test } from "bun:test"
import { checkModelAvailability } from "../../lib/model-check"

// A tiny stand-in OpenAI-compatible server: chat completions and embeddings
// succeed only for "known-model" (mirrors a real provider rejecting an
// unserved model), /v1/models/:id (the speaches load-probe) succeeds only
// for "known-model", and /models lists only "known-tts-model" (mirrors the
// tts fallback path, which still uses the list endpoint).
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
    if (url.pathname === "/embeddings") {
      const body = (await req.json()) as { model: string }
      if (body.model === "known-model") {
        return Response.json({
          data: [{ index: 0, embedding: [0.1, 0.2] }]
        })
      }
      return new Response("model not found", { status: 404 })
    }
    if (url.pathname.startsWith("/v1/models/")) {
      const id = decodeURIComponent(url.pathname.slice("/v1/models/".length))
      if (id === "known-model") return new Response(null, { status: 200 })
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

test("embedding model: available when the embeddings request succeeds", async () => {
  const ok = await checkModelAvailability({
    id: "known-model",
    task: "embedding",
    baseUrl
  })
  expect(ok).toBe(true)
})

test("embedding model: not available when the provider rejects the model id (even if absent from /models)", async () => {
  const ok = await checkModelAvailability({
    id: "unlisted-but-should-still-be-tested",
    task: "embedding",
    baseUrl
  })
  expect(ok).toBe(false)
})

test("speech-to-text model: available when the load request succeeds", async () => {
  const ok = await checkModelAvailability({
    id: "known-model",
    task: "speech-to-text",
    baseUrl
  })
  expect(ok).toBe(true)
})

test("speech-to-text model: not available when the provider rejects the model id (even if absent from /models)", async () => {
  const ok = await checkModelAvailability({
    id: "unlisted-but-should-still-be-tested",
    task: "speech-to-text",
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
