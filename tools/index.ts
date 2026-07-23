import { askUserTool, runCommandTool } from "../lib/agents"
import { config } from "../lib/config"
import { connectPlaywrightMcp } from "../lib/mcp-client"
import { currentTimeTool } from "./current-time"
import { fetchUrlTool } from "./fetch-url"
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
import { webSearchTool } from "./web-search"

/**
 * The toolset a chat session starts with: webSearchTool is only included
 * when its config group is present, since it's only usable with its own
 * credentials. Location is resolved once per session and grounded into the
 * system prompt (see lib/agents.ts run()), not exposed as a tool.
 *
 * When the `browser` config group is present, connects to the Playwright MCP
 * server and folds its tools in too. Returns `closeTools` alongside — the
 * caller must call it on shutdown to let the spawned MCP subprocess exit.
 */
export async function getDefaultTools() {
  const { webSearch, browser } = await config()
  const mcp = browser ? await connectPlaywrightMcp(browser) : undefined
  return {
    tools: [
      readFileTool,
      listFilesTool,
      fetchUrlTool,
      summarizeTool,
      rerankTool,
      currentTimeTool,
      askUserTool,
      runCommandTool,
      rememberNoteTool,
      recallMemoryTool,
      forgetNoteTool,
      listNotesTool,
      ...(webSearch ? [webSearchTool] : []),
      ...(mcp?.tools ?? [])
    ],
    closeTools: mcp?.close ?? (async () => {})
  }
}
