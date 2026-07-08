import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import type { ChatCompletionTool } from "openai/resources/chat/completions"
import { log } from "./logger"

const client = new Client({ name: "barkochba", version: "1.0.0" })
const transport = new StdioClientTransport({
	command: "bunx",
	args: ["--bun", "@modelcontextprotocol/server-filesystem", process.env.HOME!]
})

await client.connect(transport)

const { tools: mcpTools } = await client.listTools()
log.debug({ tools: mcpTools.map((t) => t.name) }, "MCP filesystem tools loaded")

export const filesystemTools: ChatCompletionTool[] = mcpTools.map((tool) => ({
	type: "function",
	function: {
		name: tool.name,
		description: tool.description ?? "",
		parameters: tool.inputSchema as Record<string, unknown>
	}
}))

const toolNames = new Set(mcpTools.map((t) => t.name))

export function isFilesystemTool(name: string) {
	return toolNames.has(name)
}

export async function callFilesystemTool(
	name: string,
	args: Record<string, unknown>
) {
	const result = await client.callTool({ name, arguments: args })
	const content = Array.isArray(result.content) ? result.content : []
	return content
		.filter((c: any) => c.type === "text")
		.map((c: any) => c.text)
		.join("\n")
}
