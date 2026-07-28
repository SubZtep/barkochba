import { basename, join } from "node:path"
import { file } from "bun"
import { type Dataset, DatasetSchema } from "../schemas/datasets"
import { getConfigDir } from "./config"
import { log } from "./logger"

/**
 * Loads user-supplied datasets from `~/.config/kaja/datasets/*.json` — a
 * sibling of tools/ and personas/, one file per topic (filename minus
 * extension is the topic id, e.g. `onboarding.json` -> topic "onboarding").
 * Each file is parsed and validated against {@link DatasetSchema}; a file
 * that fails to read, parse, or validate is skipped with a warning, so one
 * bad dataset can't stop the app from starting (same fault-tolerance as
 * lib/plugin-tools.ts).
 */
export async function loadDatasets(): Promise<Map<string, Dataset>> {
  const dir = join(getConfigDir(), "datasets")
  const glob = new Bun.Glob("*.json")
  const datasets = new Map<string, Dataset>()
  let entries: string[]
  try {
    entries = []
    for await (const match of glob.scan({ cwd: dir, dot: false })) {
      entries.push(match)
    }
  } catch {
    return datasets
  }
  for (const entry of entries.sort()) {
    const path = join(dir, entry)
    const topic = basename(entry, ".json")
    try {
      const raw = await file(path).json()
      const dataset = DatasetSchema.parse(raw)
      datasets.set(topic, dataset)
    } catch (error) {
      log.warn({ error, path }, "Failed to load dataset")
    }
  }
  return datasets
}

export async function loadDataset(topic: string): Promise<Dataset | undefined> {
  const datasets = await loadDatasets()
  return datasets.get(topic)
}
