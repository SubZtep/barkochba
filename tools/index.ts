import { askUserTool } from "../lib/agents"
import { currentTimeTool } from "./current-time"
import { myLocationTool } from "./my-location"
import { readFileTool } from "./read-file"
import { webSearchTool } from "./web-search"

/** The toolset every chat session starts with. */
export const defaultTools = [
  readFileTool,
  currentTimeTool,
  askUserTool,
  webSearchTool,
  myLocationTool
]
