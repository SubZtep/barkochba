import { askUserTool, runCommandTool } from "../lib/agents"
import { config } from "../lib/config"
import {
  connectChromeDevToolsMcp,
  connectPlaywrightMcp
} from "../lib/mcp-client"
import { currentTimeTool } from "./current-time"
import { fetchUrlTool } from "./fetch-url"
import { generateImageTool } from "./generate-image"
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
 * When the `browser` config group is present, connects to the Playwright MCP
 * server and folds its tools in too. When the `chrome` config group is
 * present, connects to the Chrome DevTools MCP server (attached to the
 * user's already-running Chrome) and folds its tools in as well. Returns
 * `closeTools` alongside — the caller must call it on shutdown to let the
 * spawned MCP subprocesses exit.
 */
export async function getDefaultTools() {
  const { webSearch, browser, chrome, imageGen } = await config()
  const [playwright, chromeDevTools] = await Promise.all([
    browser ? connectPlaywrightMcp(browser) : undefined,
    chrome ? connectChromeDevToolsMcp() : undefined
  ])
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
      ...(webSearch ? [webSearchTool] : []),
      ...(imageGen ? [generateImageTool] : []),
      ...(playwright?.tools ?? []),
      ...(chromeDevTools?.tools ?? [])
    ],
    closeTools: async () => {
      await Promise.all([playwright?.close(), chromeDevTools?.close()])
    }
  }
}
