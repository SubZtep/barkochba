import { join } from "node:path"
import { file, TOML, write } from "bun"
// Written on first run: a ready-to-use example server (Playwright) plus
// commented-out alternatives, sourced from the same file that documents
// mcp.toml on the docs site.
import TEMPLATE from "../docs/config/mcp.toml" with { type: "text" }
import { type KajaMcpFile, McpFileSchema } from "../schemas/mcp"
import { getConfigDir } from "./config"
import { t } from "./i18n"

export function getMcpPath() {
  return join(getConfigDir(), "mcp.toml")
}

/**
 * Load the MCP servers file. Missing file: writes the example template and
 * returns its active servers. Invalid file: prints the error and exits, same
 * policy as {@link config}.
 */
export async function loadMcpServers(): Promise<KajaMcpFile["servers"]> {
  const mcpPath = getMcpPath()
  const f = file(mcpPath)
  // Parse TEMPLATE directly rather than reading it back: a freshly written
  // BunFile can report stale (empty) content on an immediate re-read.
  const exists = await f.exists()
  if (!exists) await write(f, TEMPLATE)
  const text = exists ? await f.text() : TEMPLATE
  try {
    return McpFileSchema.parse(TOML.parse(text)).servers
  } catch (error: any) {
    console.log(t("mcp.invalidAt", { path: mcpPath, message: error.message }))
    process.exit(1)
  }
}
