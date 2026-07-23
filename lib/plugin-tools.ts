import { join } from "node:path"
import type { Tool } from "./agents"
import { getConfigDir } from "./config"
import { log } from "./logger"

function isTool(value: unknown): value is Tool<any> {
  return (
    typeof value === "object" &&
    value !== null &&
    "definition" in value &&
    "execute" in value &&
    typeof (value as Tool<any>).execute === "function"
  )
}

/**
 * Loads user-supplied tools from `~/.config/kaja/tools/*.ts` — a sibling of
 * personas.toml, for tools the user wants available locally without adding
 * them to this repo (e.g. a one-off persona-specific tool). Each file is
 * dynamically imported and any exported {@link Tool} values (built with the
 * `tool()` helper from lib/agents.ts) are collected; other exports are
 * ignored. A file that fails to import or throws while loading is skipped
 * with a warning, so one broken plugin can't stop the app from starting.
 */
export async function loadPluginTools(): Promise<Tool<any>[]> {
  const dir = join(getConfigDir(), "tools")
  const glob = new Bun.Glob("*.ts")
  const tools: Tool<any>[] = []
  let entries: string[]
  try {
    entries = []
    for await (const match of glob.scan({ cwd: dir, dot: false })) {
      entries.push(match)
    }
  } catch {
    return tools
  }
  for (const entry of entries.sort()) {
    const path = join(dir, entry)
    try {
      const exports: Record<string, unknown> = await import(path)
      for (const value of Object.values(exports)) {
        if (isTool(value)) tools.push(value)
      }
    } catch (error) {
      log.warn({ error, path }, "Failed to load plugin tool")
    }
  }
  return tools
}
