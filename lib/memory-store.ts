import { rename } from "node:fs/promises"
import { join } from "node:path"
import envPaths from "env-paths"
import { type MemoryStore, MemoryStoreSchema } from "../schemas/memory"

const paths = envPaths("kaja", { suffix: "" })
export const memoryPath = join(paths.data, "memory.json")

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
