import { askUserTool, runCommandTool } from "../lib/agents"
import { config } from "../lib/config"
import { connectMcpServer } from "../lib/mcp-client"
import { loadMcpServers } from "../lib/mcp-servers"
import { loadPluginTools } from "../lib/plugin-tools"
import { currentTimeTool } from "./current-time"
import { fetchUrlTool } from "./fetch-url"
import { generateImageTool } from "./generate-image"
import { likeOrNotGameTool } from "./like-or-not"
import { listFilesTool } from "./list-files"
import {
  forgetNoteTool,
  listNotesTool,
  recallMemoryTool,
  rememberNoteTool
} from "./memory"
import { readFileTool } from "./read-file"
import { rerankTool } from "./rerank"
import { summarizeTool } from "./summarize"
import { viewImageTool } from "./view-image"
import { webSearchTool } from "./web-search"

/**
 * The toolset a chat session starts with: webSearchTool is only included
 * when its config group is present, since it's only usable with its own
 * credentials. Location is resolved once per session and grounded into the
 * system prompt (see lib/agents.ts run()), not exposed as a tool.
 *
 * Every server listed in `~/.config/kaja/mcp.toml` (see lib/mcp-servers.ts)
 * is spawned and its tools folded in — adding a server there is enough, no
 * code changes needed. Also folds in any user-supplied tools from
 * `~/.config/kaja/tools/*.ts` (see lib/plugin-tools.ts) — a way to add tools
 * locally without shipping them in this repo. Returns `closeTools` alongside
 * — the caller must call it on shutdown to let the spawned MCP subprocesses
 * exit.
 */
export async function getDefaultTools() {
  const { webSearch, imageGen } = await config()
  const [mcpServers, pluginTools] = await Promise.all([
    loadMcpServers(),
    loadPluginTools()
  ])
  const mcpConnections = await Promise.all(
    mcpServers.map((server) => connectMcpServer(server))
  )
  return {
    tools: [
      readFileTool,
      listFilesTool,
      fetchUrlTool,
      viewImageTool,
      summarizeTool,
      rerankTool,
      currentTimeTool,
      askUserTool,
      runCommandTool,
      rememberNoteTool,
      recallMemoryTool,
      forgetNoteTool,
      listNotesTool,
      likeOrNotGameTool,
      ...(webSearch ? [webSearchTool] : []),
      ...(imageGen ? [generateImageTool] : []),
      ...mcpConnections.flatMap((connection) => connection.tools),
      ...pluginTools
    ],
    closeTools: async () => {
      await Promise.all(mcpConnections.map((connection) => connection.close()))
    }
  }
}
