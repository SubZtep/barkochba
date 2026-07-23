import { askUserTool, runCommandTool } from "../lib/agents"
import { config } from "../lib/config"
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
import { webSearchTool } from "./web-search"

/**
 * The toolset a chat session starts with: webSearchTool is only included
 * when its config group is present, since it's only usable with its own
 * credentials. Location is resolved once per session and grounded into the
 * system prompt (see lib/agents.ts run()), not exposed as a tool.
 */
export async function getDefaultTools() {
  const { webSearch } = await config()
  return [
    readFileTool,
    listFilesTool,
    fetchUrlTool,
    currentTimeTool,
    askUserTool,
    runCommandTool,
    rememberNoteTool,
    recallMemoryTool,
    forgetNoteTool,
    listNotesTool,
    ...(webSearch ? [webSearchTool] : [])
  ]
}
