import { randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { write } from "bun"
import envPaths from "env-paths"
import type { KajaBrowser } from "../schemas/config"
import { type Tool, type ToolResult, tool } from "./agents"

/**
 * Spawns an MCP server over stdio and adapts each of its tools into a Kaja
 * {@link Tool}, so the agent loop can call it exactly like any built-in tool.
 *
 * @returns The adapted tools, and `close()` to shut down the connection and
 * let the spawned subprocess exit — callers must call this on app shutdown
 * to avoid leaving it orphaned.
 */
async function connectStdioMcp(
  command: string,
  args: string[]
): Promise<{ tools: Tool<any>[]; close: () => Promise<void> }> {
  const transport = new StdioClientTransport({
    command,
    args,
    // Default "inherit" would let the subprocess write straight to the
    // parent's stderr, corrupting Kaja's Ink terminal rendering.
    stderr: "ignore"
  })

  const client = new Client({ name: "kaja", version: "1.0.0" })
  await client.connect(transport)

  const { tools: mcpTools } = await client.listTools()
  const tools = mcpTools.map((mcpTool) =>
    tool<Record<string, unknown>>({
      name: mcpTool.name,
      description: mcpTool.description ?? mcpTool.name,
      // MCP input schemas are already JSON Schema objects, compatible as-is.
      parameters: mcpTool.inputSchema,
      execute: (args) => callTool(client, mcpTool.name, args)
    })
  )

  return { tools, close: () => client.close() }
}

/**
 * Connects to the Playwright MCP server (spawned via `bunx @playwright/mcp`)
 * — an isolated, automation-only browser — and adapts its tools for the
 * agent loop.
 */
export async function connectPlaywrightMcp(
  options: KajaBrowser = {}
): Promise<{ tools: Tool<any>[]; close: () => Promise<void> }> {
  const args = ["@playwright/mcp@latest", "--isolated"]
  if (options.headless ?? true) args.push("--headless")
  return connectStdioMcp("bunx", args)
}

/**
 * Connects to the Chrome DevTools MCP server (spawned via
 * `bunx chrome-devtools-mcp`), attached to the user's already-running Chrome
 * via `--autoConnect` — so the agent sees whatever page the user actually
 * has open, rather than an isolated automation browser. Requires Chrome's
 * remote debugging server to be enabled (chrome://inspect/#remote-debugging).
 */
export async function connectChromeDevToolsMcp(): Promise<{
  tools: Tool<any>[]
  close: () => Promise<void>
}> {
  return connectStdioMcp("bunx", [
    "chrome-devtools-mcp@latest",
    "--autoConnect"
  ])
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const result = await client.callTool({ name, arguments: args })
  const content = (result.content ?? []) as Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >

  const text = content
    .filter(
      (block): block is { type: "text"; text: string } => block.type === "text"
    )
    .map((block) => block.text)
    .join("\n")

  const imageBlocks = content.filter(
    (block): block is { type: "image"; data: string; mimeType: string } =>
      block.type === "image"
  )
  if (imageBlocks.length === 0) return { text: text || `${name}: done` }

  const dir = envPaths("kaja", { suffix: "" }).temp
  await mkdir(dir, { recursive: true })
  const images = await Promise.all(
    imageBlocks.map(async (block) => {
      const ext = block.mimeType.split("/")[1] ?? "png"
      const path = join(dir, `${randomUUID()}.${ext}`)
      await write(path, Buffer.from(block.data, "base64"))
      return { path, mimeType: block.mimeType }
    })
  )

  return { text: text || `${name}: done`, images }
}
