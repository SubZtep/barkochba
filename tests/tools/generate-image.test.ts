import { afterEach, beforeEach, expect, test } from "bun:test"

process.env.XDG_CONFIG_HOME = `${import.meta.dir}/../../.tmp-test-xdg-config-generate-image`

const { saveConfig } = await import("../../lib/config")
await saveConfig({
  llm: {
    baseUrl: "http://localhost/v1",
    apiKey: "llm-key",
    model: "test-model"
  },
  imageGen: {
    baseUrl: "https://api.x.ai/v1",
    apiKey: "xai-key",
    model: "grok-imagine-image-quality"
  }
})

const { generateImageTool } = await import("../../tools/generate-image")

let requests: { url: string; init: RequestInit }[] = []
const originalFetch = globalThis.fetch

beforeEach(() => {
  requests = []
  globalThis.fetch = (async (
    url: string | URL | Request,
    init?: RequestInit
  ) => {
    requests.push({ url: url.toString(), init: init ?? {} })
    if (url.toString().includes("/images/generations")) {
      return new Response(
        JSON.stringify({ data: [{ url: "https://cdn.example/image.png" }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    }
    return new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: { "content-type": "image/png" }
    })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

test("generate_image posts the configured model and prompt, then saves the image", async () => {
  const result = await generateImageTool.execute({ prompt: "a red fox" })

  const genRequest = requests.find((r) => r.url.includes("/images/generations"))
  expect(genRequest?.url).toBe("https://api.x.ai/v1/images/generations")
  const body = JSON.parse(genRequest!.init.body as string)
  expect(body.model).toBe("grok-imagine-image-quality")
  expect(body.prompt).toBe("a red fox")

  expect(typeof result).toBe("object")
  const toolResult = result as {
    text: string
    images?: { path: string; mimeType: string }[]
  }
  expect(toolResult.text).toBe("Generated image: a red fox")
  expect(toolResult.images?.[0]?.mimeType).toBe("image/png")
  expect(await Bun.file(toolResult.images![0]!.path).exists()).toBe(true)
})

test("generate_image omits model from the request when not configured", async () => {
  await saveConfig({
    llm: {
      baseUrl: "http://localhost/v1",
      apiKey: "llm-key",
      model: "test-model"
    },
    imageGen: { baseUrl: "https://api.x.ai/v1", apiKey: "xai-key" }
  })

  await generateImageTool.execute({ prompt: "a blue fox" })

  const genRequest = requests.find((r) => r.url.includes("/images/generations"))
  const body = JSON.parse(genRequest!.init.body as string)
  expect(body.model).toBeUndefined()
})

test("generate_image reports when not configured", async () => {
  await saveConfig({
    llm: {
      baseUrl: "http://localhost/v1",
      apiKey: "llm-key",
      model: "test-model"
    }
  })

  const result = await generateImageTool.execute({ prompt: "a red fox" })
  expect(result).toBe("Image generation is not configured.")
})
