import { randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { write } from "bun"
import type { McpServerEntry } from "../schemas/mcp"
import { type Tool, type ToolResult, tool } from "./agents"
import { getPaths } from "./paths"

/**
 * Spawns an MCP server over stdio (as configured in mcp.toml, see
 * lib/mcp-servers.ts) and adapts each of its tools into a Kaja {@link Tool},
 * so the agent loop can call it exactly like any built-in tool.
 *
 * @returns The adapted tools, and `close()` to shut down the connection and
 * let the spawned subprocess exit — callers must call this on app shutdown
 * to avoid leaving it orphaned.
 */
export async function connectMcpServer(
  server: McpServerEntry
): Promise<{ tools: Tool<any>[]; close: () => Promise<void> }> {
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args,
    env: { ...process.env, ...server.env } as Record<string, string>,
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

  const dir = getPaths().temp
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
