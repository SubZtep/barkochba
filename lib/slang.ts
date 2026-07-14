// Hungarian slang dictionary (assets/hogymondom.json) embedded into SQLite
// for semantic lookup: seed once with `bun run seed-slang.ts`, then
// lookupSlang() returns the dictionary entries closest in meaning to a phrase
// — robust to the mangled transcripts STT produces, unlike string matching.

import { Database } from "bun:sqlite"
import { log } from "./logger"
import { client } from "./openai"

const db = new Database(process.env.BRAIN_DB ?? "brain.sqlite")
db.run(`
	CREATE TABLE IF NOT EXISTS slang (
		word TEXT PRIMARY KEY,
		description TEXT NOT NULL,
		embedding BLOB NOT NULL
	)
`)

// nomic-embed models want asymmetric task prefixes for retrieval:
// documents are embedded once with "search_document:", queries with "search_query:".
async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await client.embeddings.create({
    model: process.env.OPENAI_API_MODEL_EMBEDDING!,
    input: texts,
    encoding_format: "float"
  })
  return res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding)
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    magA += a[i]! * a[i]!
    magB += b[i]! * b[i]!
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}

export async function seedSlang(jsonPath = "assets/hogymondom.json") {
  const entries = (await Bun.file(jsonPath).json()) as {
    word: string
    description: string
  }[]
  const existing = new Set(
    (
      db.prepare("SELECT word FROM slang").all() as {
        word: string
      }[]
    ).map((r) => r.word)
  )
  const seen = new Set<string>()
  const pending = entries.filter((e) => {
    if (existing.has(e.word) || seen.has(e.word)) return false
    seen.add(e.word)
    return true
  })
  log.info(
    {
      total: entries.length,
      pending: pending.length
    },
    "slang: seeding dictionary"
  )
  const insert = db.prepare(
    "INSERT OR IGNORE INTO slang (word, description, embedding) VALUES (?, ?, ?)"
  )
  const batchSize = 64
  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize)
    const vectors = await embedBatch(
      batch.map((e) => `search_document: ${e.word}\n${e.description}`)
    )
    for (const [j, entry] of batch.entries()) {
      insert.run(
        entry.word,
        entry.description,
        new Uint8Array(Float32Array.from(vectors[j]!).buffer)
      )
    }
    log.info(
      {
        done: Math.min(i + batchSize, pending.length),
        of: pending.length
      },
      "slang: seeded batch"
    )
  }
}

type SlangRow = { word: string; description: string; embedding: Float32Array }
let cache: SlangRow[] | null = null

/** Dictionary entries closest in meaning to `phrase`, best match first. */
export async function lookupSlang(
  phrase: string,
  topN = 3
): Promise<{ word: string; description: string; score: number }[]> {
  if (!cache) {
    cache = (
      db.prepare("SELECT word, description, embedding FROM slang").all() as {
        word: string
        description: string
        embedding: Uint8Array
      }[]
    ).map((r) => ({
      word: r.word,
      description: r.description,
      embedding: new Float32Array(
        r.embedding.buffer,
        r.embedding.byteOffset,
        r.embedding.byteLength / 4
      )
    }))
    log.info(
      {
        entries: cache.length
      },
      "slang: dictionary loaded"
    )
  }
  if (!cache.length) return []
  const [queryEmbedding] = await embedBatch([`search_query: ${phrase}`])
  const query = Float32Array.from(queryEmbedding!)
  const scored = cache
    .map((r) => ({
      word: r.word,
      description: r.description,
      score: cosineSimilarity(query, r.embedding)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
  log.debug({ phrase, matches: scored }, "slang: lookup")
  return scored
}
