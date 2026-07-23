import { randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { write } from "bun"
import envPaths from "env-paths"
import OpenAI from "openai"
import { ToolError, tool } from "../lib/agents"
import { config } from "../lib/config"

/**
 * Generates an image from a text prompt via an OpenAI-compatible Images API
 * (e.g. xAI's Grok Imagine) and saves it to a temp file.
 *
 * @param args.prompt - Description of the image to generate.
 * @returns A {@link ToolResult} carrying the saved image; run() injects it as
 * a vision content block in a follow-up user message.
 */
export const generateImageTool = tool<{ prompt: string }>({
  name: "generate_image",
  description: "Generate an image from a text prompt.",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "Description of the image to generate"
      }
    },
    required: ["prompt"]
  },
  execute: async (args) => {
    const { imageGen } = await config()
    if (!imageGen) return "Image generation is not configured."

    const client = new OpenAI({
      apiKey: imageGen.apiKey,
      baseURL: imageGen.baseUrl
    })
    const response = await client.images.generate({
      ...(imageGen.model ? { model: imageGen.model } : {}),
      prompt: args.prompt
    })
    const url = response.data?.[0]?.url
    if (!url) return "Image generation returned no image."

    const res = await fetch(url)
    if (!res.ok)
      throw new ToolError(
        "generate_image",
        `Failed to download generated image: ${res.status}`
      )
    const mimeType = res.headers.get("content-type") ?? "image/png"
    const ext = mimeType.split("/")[1] ?? "png"

    const dir = envPaths("kaja", { suffix: "" }).temp
    await mkdir(dir, { recursive: true })
    const path = join(dir, `${randomUUID()}.${ext}`)
    await write(path, await res.arrayBuffer())

    return {
      text: `Generated image: ${args.prompt}`,
      images: [{ path, mimeType }]
    }
  }
})
