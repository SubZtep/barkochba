import { tool } from "../lib/agents"

/**
 * Reads a text file from disk.
 *
 * @param args.path - Path to the file to read.
 * @returns The file's contents as a string.
 */
export const readFileTool = tool<{ path: string }>({
  name: "read_file",
  description: "Read a text file",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file"
      }
    },
    required: ["path"]
  },
  execute: async (args) => await Bun.file(args.path).text()
})
