import { tool } from "../lib/agents"

/**
 * Lists files under a directory, optionally by glob pattern.
 *
 * @param args.path - Directory to list.
 * @param args.pattern - Glob pattern relative to path (default "*", immediate children only; use e.g. "**\/*" to recurse).
 * @returns Matching paths, one per line, relative to path.
 */
export const listFilesTool = tool<{ path: string; pattern?: string }>({
  name: "list_files",
  description:
    "List files under a directory. Optionally filter with a glob pattern (default lists immediate children only; use a recursive pattern like '**/*.ts' to search subdirectories).",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Directory to list"
      },
      pattern: {
        type: "string",
        description:
          "Glob pattern relative to path, e.g. '*.ts' or '**/*.ts'. Defaults to '*' (immediate children only)."
      }
    },
    required: ["path"]
  },
  execute: async (args) => {
    const glob = new Bun.Glob(args.pattern ?? "*")
    const matches: string[] = []
    for await (const match of glob.scan({ cwd: args.path, dot: false })) {
      matches.push(match)
    }
    return matches.length > 0 ? matches.sort().join("\n") : "(no matches)"
  }
})
