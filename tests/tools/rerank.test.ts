import { afterEach, beforeEach, expect, test } from "bun:test"

process.env.XDG_CONFIG_HOME = `${import.meta.dir}/../../.tmp-test-xdg-config-rerank`

const { saveConfig } = await import("../../lib/config")
await saveConfig({
  llm: {
    baseUrl: "http://localhost/v1",
    apiKey: "llm-key",
    model: "test-model"
  }
})

const { rerankTool } = await import("../../tools/rerank")

let lastRequest: { url: string; init: RequestInit } | undefined
const originalFetch = globalThis.fetch

beforeEach(() => {
  lastRequest = undefined
  globalThis.fetch = (async (
    url: string | URL | Request,
    init?: RequestInit
  ) => {
    lastRequest = { url: url.toString(), init: init ?? {} }
    return new Response(
      JSON.stringify({
        object: "list",
        model: "accounts/fireworks/models/qwen3-reranker-8b",
        data: [
          { index: 1, relevance_score: 0.9, document: "b" },
          { index: 0, relevance_score: 0.1, document: "a" }
        ],
        usage: { prompt_tokens: 1, total_tokens: 2 }
      }),
      { status: 200 }
    )
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

test("rerank posts to the fireworks endpoint and returns ranked results", async () => {
  const result = await rerankTool.execute({
    query: "what is ai",
    documents: ["a", "b"]
  })
  expect(lastRequest?.url).toBe("http://localhost/v1/rerank")
  const body = JSON.parse(lastRequest!.init.body as string)
  expect(body.model).toBe("accounts/fireworks/models/qwen3-reranker-8b")
  expect(body.query).toBe("what is ai")
  expect(body.documents).toEqual(["a", "b"])
  expect(
    (lastRequest!.init.headers as Record<string, string>).Authorization
  ).toBe("Bearer llm-key")
  expect(JSON.parse(result)).toEqual([
    { index: 1, relevance_score: 0.9, document: "b" },
    { index: 0, relevance_score: 0.1, document: "a" }
  ])
})

test("rerank passes top_n through when given", async () => {
  await rerankTool.execute({
    query: "q",
    documents: ["a", "b"],
    top_n: 1
  })
  const body = JSON.parse(lastRequest!.init.body as string)
  expect(body.top_n).toBe(1)
})

test("rerank config overrides take precedence over llm config", async () => {
  await saveConfig({
    llm: {
      baseUrl: "http://localhost/v1",
      apiKey: "llm-key",
      model: "test-model"
    },
    rerank: {
      baseUrl: "http://rerank-host/v1",
      apiKey: "rerank-key",
      model: "custom-reranker"
    }
  })
  await rerankTool.execute({ query: "q", documents: ["a"] })
  expect(lastRequest?.url).toBe("http://rerank-host/v1/rerank")
  const body = JSON.parse(lastRequest!.init.body as string)
  expect(body.model).toBe("custom-reranker")
  expect(
    (lastRequest!.init.headers as Record<string, string>).Authorization
  ).toBe("Bearer rerank-key")
})
