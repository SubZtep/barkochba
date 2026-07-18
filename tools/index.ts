import { askUserTool, runCommandTool } from "../lib/agents"
import { config } from "../lib/config"
import { currentTimeTool } from "./current-time"
import { fetchUrlTool } from "./fetch-url"
import { listFilesTool } from "./list-files"
import { myLocationTool } from "./my-location"
import { readFileTool } from "./read-file"
import { webSearchTool } from "./web-search"

/**
 * The toolset a chat session starts with: webSearchTool/myLocationTool are
 * only included when their config group is present, since each is only
 * usable with its own credentials.
 */
export async function getDefaultTools() {
  const { webSearch, location } = await config()
  return [
    readFileTool,
    listFilesTool,
    fetchUrlTool,
    currentTimeTool,
    askUserTool,
    runCommandTool,
    ...(webSearch ? [webSearchTool] : []),
    ...(location ? [myLocationTool] : [])
  ]
}
