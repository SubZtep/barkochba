import { afterEach, beforeEach, expect, test } from "bun:test"

process.env.XDG_CONFIG_HOME = `${import.meta.dir}/../../.tmp-test-xdg-config-embeddings`

const { saveConfig } = await import("../../lib/config")
await saveConfig({
  llm: {
    baseUrl: "http://localhost/v1",
    apiKey: "llm-key",
    model: "test-model"
  }
})

const { embed, cosineSimilarity } = await import("../../lib/embeddings")

let lastRequest: { url: string; init: RequestInit } | undefined
const originalFetch = globalThis.fetch

function cannedResponse(vectors: number[][]) {
  return new Response(
    JSON.stringify({
      object: "list",
      model: "nomic-ai/nomic-embed-text-v1.5",
      data: vectors.map((embedding, index) => ({
        object: "embedding",
        index,
        embedding
      })),
      usage: { prompt_tokens: 1, total_tokens: 1 }
    }),
    // The openai SDK client (unlike rerank.ts's raw fetch + res.json()) only
    // parses the body as JSON when the Content-Type header says so —
    // without it, .create() resolves to the raw response string instead of
    // the parsed object.
    { status: 200, headers: { "content-type": "application/json" } }
  )
}

beforeEach(() => {
  lastRequest = undefined
  globalThis.fetch = (async (
    url: string | URL | Request,
    init?: RequestInit
  ) => {
    lastRequest = { url: url.toString(), init: init ?? {} }
    return cannedResponse([[0.1, 0.2, 0.3]])
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

test("embed posts to the configured baseUrl's /embeddings endpoint", async () => {
  const result = await embed("hello world")
  expect(lastRequest?.url).toBe("http://localhost/v1/embeddings")
  const body = JSON.parse(lastRequest!.init.body as string)
  expect(body.model).toBe("nomic-ai/nomic-embed-text-v1.5")
  expect(body.input).toBe("hello world")
  expect((lastRequest!.init.headers as Headers).get("authorization")).toBe(
    "Bearer llm-key"
  )
  expect(result).toEqual([[0.1, 0.2, 0.3]])
})

test("embed batches multiple inputs into one request", async () => {
  globalThis.fetch = (async (
    url: string | URL | Request,
    init?: RequestInit
  ) => {
    lastRequest = { url: url.toString(), init: init ?? {} }
    return cannedResponse([
      [1, 0, 0],
      [0, 1, 0]
    ])
  }) as typeof fetch

  const result = await embed(["a", "b"])
  const body = JSON.parse(lastRequest!.init.body as string)
  expect(body.input).toEqual(["a", "b"])
  expect(result).toEqual([
    [1, 0, 0],
    [0, 1, 0]
  ])
})

test("embedding config overrides take precedence over llm config", async () => {
  await saveConfig({
    llm: {
      baseUrl: "http://localhost/v1",
      apiKey: "llm-key",
      model: "test-model"
    },
    embedding: {
      baseUrl: "http://embedding-host/v1",
      apiKey: "embedding-key",
      model: "custom-embedder"
    }
  })
  await embed("hello")
  expect(lastRequest?.url).toBe("http://embedding-host/v1/embeddings")
  const body = JSON.parse(lastRequest!.init.body as string)
  expect(body.model).toBe("custom-embedder")
  expect((lastRequest!.init.headers as Headers).get("authorization")).toBe(
    "Bearer embedding-key"
  )
})

test("cosineSimilarity of identical vectors is 1", () => {
  expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1)
})

test("cosineSimilarity of orthogonal vectors is 0", () => {
  expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
})

test("cosineSimilarity of opposite vectors is -1", () => {
  expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1)
})
