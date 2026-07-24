import { join } from "node:path"
import { file, TOML, write } from "bun"
import { type KajaMcpFile, McpFileSchema } from "../schemas/mcp"
import { getConfigDir } from "./config"
import { t } from "./i18n"

export function getMcpPath() {
  return join(getConfigDir(), "mcp.toml")
}

// Written on first run; everything is commented out, which parses as an
// empty (valid) file until the user fills it in.
const TEMPLATE = `# MCP servers available to Kaja, one [[servers]] entry each. Every server
# listed here is spawned over stdio and its tools are folded into the agent's
# toolset automatically — just add an entry, no code changes needed.

# [[servers]]
# id = "playwright"
# command = "bunx"
# args = ["@playwright/mcp@latest", "--isolated", "--headless"]

# [[servers]]
# id = "chrome-devtools"
# command = "bunx"
# args = ["chrome-devtools-mcp@latest", "--autoConnect"]

# [[servers]]
# id = "example-with-env"
# command = "npx"
# args = ["-y", "some-mcp-server"]
# env = { API_KEY = "..." }
`

/**
 * Load the MCP servers file. Missing file: writes a commented template and
 * returns no servers (the app works without them). Invalid file: prints the
 * error and exits, same policy as {@link config}.
 */
export async function loadMcpServers(): Promise<KajaMcpFile["servers"]> {
  const mcpPath = getMcpPath()
  const f = file(mcpPath)
  if (!(await f.exists())) {
    await write(f, TEMPLATE)
    return []
  }
  try {
    return McpFileSchema.parse(TOML.parse(await f.text())).servers
  } catch (error: any) {
    console.log(t("mcp.invalidAt", { path: mcpPath, message: error.message }))
    process.exit(1)
  }
}
