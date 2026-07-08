import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { ChatCompletionTool } from "openai/resources/chat/completions"
import { log } from "./logger"

const filesystemClient = new Client({ name: "barkochba", version: "1.0.0" })
await filesystemClient.connect(
	new StdioClientTransport({
		command: "bunx",
		args: ["--bun", "@modelcontextprotocol/server-filesystem", process.env.HOME!]
	})
)

const context7Client = new Client({ name: "barkochba", version: "1.0.0" })
await context7Client.connect(
	new StreamableHTTPClientTransport(new URL("https://mcp.context7.com/mcp"), {
		requestInit: {
			headers: { CONTEXT7_API_KEY: process.env.CONTEXT7_API_KEY! }
		}
	})
)

const clients = [filesystemClient, context7Client]

const toolOwners = new Map<string, Client>()
const allTools: ChatCompletionTool[] = []

for (const client of clients) {
	const { tools } = await client.listTools()
	for (const tool of tools) {
		toolOwners.set(tool.name, client)
		allTools.push({
			type: "function",
			function: {
				name: tool.name,
				description: tool.description ?? "",
				parameters: tool.inputSchema as Record<string, unknown>
			}
		})
	}
}

log.debug({ tools: [...toolOwners.keys()] }, "MCP tools loaded")

export const mcpTools = allTools

export function isMcpTool(name: string) {
	return toolOwners.has(name)
}

export async function callMcpTool(name: string, args: Record<string, unknown>) {
	const client = toolOwners.get(name)
	if (!client) throw new Error(`Unknown MCP tool: ${name}`)
	const result = await client.callTool({ name, arguments: args })
	const content = Array.isArray(result.content) ? result.content : []
	return content
		.filter((c: any) => c.type === "text")
		.map((c: any) => c.text)
		.join("\n")
}
