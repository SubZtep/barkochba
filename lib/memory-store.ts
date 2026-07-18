import { rename } from "node:fs/promises"
import { join } from "node:path"
import envPaths from "env-paths"
import {
  type MemoryNote,
  type MemoryStore,
  MemoryStoreSchema
} from "../schemas/memory"

const paths = envPaths("kaja", { suffix: "" })
export const memoryPath = join(paths.data, "memory.json")

/**
 * One-line note header shared by the memory tools and the `kaja memory`
 * CLI, so the model and the human see the same self-explanatory metadata
 * (importance, sticky, tags, last-used day) everywhere:
 * `user:who-they-are [high, sticky] (tags: user, kaja) (used 2026-07-18)`
 */
export function noteHeader(key: string, note: MemoryNote) {
  const flags = note.sticky ? `${note.importance}, sticky` : note.importance
  const tags = note.tags.length > 0 ? ` (tags: ${note.tags.join(", ")})` : ""
  return `${key} [${flags}]${tags} (used ${note.lastUsedAt.slice(0, 10)})`
}

/**
 * Deletes notes from a store in place by exact key, by tag, or by key glob
 * pattern, returning the deleted keys (without saving — callers decide).
 */
export function forgetNotes(
  store: MemoryStore,
  selector: { key?: string; tag?: string; pattern?: string }
): string[] {
  let victims: string[]
  if (selector.key !== undefined) {
    victims = selector.key in store ? [selector.key] : []
  } else if (selector.tag !== undefined) {
    victims = Object.entries(store)
      .filter(([, note]) => note.tags.includes(selector.tag!))
      .map(([key]) => key)
  } else if (selector.pattern !== undefined) {
    const glob = new Bun.Glob(selector.pattern)
    victims = Object.keys(store).filter((key) => glob.match(key))
  } else {
    victims = []
  }
  for (const key of victims) delete store[key]
  return victims
}

export async function loadMemory(): Promise<MemoryStore> {
  const f = Bun.file(memoryPath)
  if (!(await f.exists())) return {}
  try {
    return MemoryStoreSchema.parse(await f.json())
  } catch {
    return {}
  }
}

export async function saveMemory(store: MemoryStore) {
  const tmp = `${memoryPath}.tmp`
  await Bun.write(tmp, JSON.stringify(store, null, 2))
  await rename(tmp, memoryPath)
}
