import { basename, join } from "node:path"
import { file } from "bun"
import { type Dataset, DatasetSchema } from "../schemas/datasets"
import { getConfigDir } from "./config"
import { log } from "./logger"

function isExcluded(entry: Dataset["entries"][number], dataset: Dataset) {
  if (dataset.excludeNames?.includes(entry.name)) return true
  if (!dataset.excludeKeywords || dataset.excludeKeywords.length === 0)
    return false
  const haystack = `${entry.name} ${entry.description}`.toLowerCase()
  return dataset.excludeKeywords.some((word) =>
    haystack.includes(word.toLowerCase())
  )
}

/**
 * Loads user-supplied game datasets from `~/.config/kaja/datasets/*.json` —
 * a sibling of tools/ and personas.toml, one file per topic (filename minus
 * extension is the topic id, e.g. `movies.json` -> topic "movies"). Each
 * file is parsed and validated against {@link DatasetSchema}; a file that
 * fails to read, parse, or validate is skipped with a warning, so one bad
 * dataset can't stop the app from starting (same fault-tolerance as
 * lib/plugin-tools.ts). Each dataset's own excludeNames/excludeKeywords are
 * applied to its entries before returning.
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
      datasets.set(topic, {
        ...dataset,
        entries: dataset.entries.filter((e) => !isExcluded(e, dataset))
      })
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
