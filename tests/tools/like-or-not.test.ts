import { afterEach, beforeEach, expect, test } from "bun:test"
import { cpSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Isolated from other test files' XDG dirs, same as tests/tools/memory.test.ts.
// A private copy of the datasets fixtures (not the shared read-only
// tests/fixtures/datasets dir) because confirming a candidate now also
// writes config.json here via saveConfig — needed so embed() (lib/embeddings.ts)
// has real llm credentials to construct its OpenAI client from, even though
// the actual network call is stubbed below. XDG_DATA_HOME is a private tmp
// dir so confirmed results don't leak between test files.
const configDir = `${tmpdir()}/kaja-test-xdg-config-like-or-not`
mkdirSync(configDir, { recursive: true })
cpSync(
  join(import.meta.dir, "../fixtures/datasets/kaja"),
  join(configDir, "kaja"),
  {
    recursive: true
  }
)
process.env.XDG_CONFIG_HOME = configDir
process.env.XDG_DATA_HOME = `${tmpdir()}/kaja-test-xdg-data-like-or-not`

const { saveConfig } = await import("../../lib/config")
await saveConfig({
  llm: {
    baseUrl: "http://localhost/v1",
    apiKey: "llm-key",
    model: "test-model"
  }
})

const { getDb } = await import("../../lib/memory-store")
const { likeOrNotGameTool } = await import("../../tools/like-or-not")

const originalFetch = globalThis.fetch

// Per-input vector overrides for similarity tests (keyed by the exact
// "name: description" string embed() sends) — falls back to a fixed
// arbitrary vector for every other test, which only cares that a vector
// gets stored, not what it is.
let vectorOverrides: Record<string, number[]> = {}

beforeEach(() => {
  vectorOverrides = {}
  // Stubs every embed() call (lib/embeddings.ts) triggered by confirm/
  // auto-confirm paths — these tests mostly only verify game logic and
  // text/table state, not real embedding similarity (that's
  // tests/lib/embeddings.test.ts's job). Echoes back one vector per input
  // so batched calls (the bulk-dislike path can embed up to 5 at once) get
  // a matching-length response.
  globalThis.fetch = (async (_url, init) => {
    const body = JSON.parse((init?.body as string) ?? "{}")
    const inputs: string[] = Array.isArray(body.input)
      ? body.input
      : [body.input]
    return new Response(
      JSON.stringify({
        object: "list",
        model: "test",
        data: inputs.map((input, index) => ({
          object: "embedding",
          index,
          embedding: vectorOverrides[input] ?? [0.1, 0.2, 0.3]
        })),
        usage: { prompt_tokens: 1, total_tokens: 1 }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )
  }) as typeof fetch
})

afterEach(async () => {
  globalThis.fetch = originalFetch
  const database = await getDb()
  database.query("DELETE FROM game_results").run()
  database.query("DELETE FROM game_rounds").run()
})

test("list_topics lists discovered dataset topics with their labels", async () => {
  const result = (await likeOrNotGameTool.execute({
    action: "list_topics"
  })) as string
  expect(result).toContain("movies: Movies to watch")
})

test("start loads a topic's pool", async () => {
  const result = await likeOrNotGameTool.execute({
    action: "start",
    topic: "movies"
  })
  expect(result).toContain('Round started for "movies"')
  expect(result).toContain("9 candidates loaded")
})

test("start on an unknown topic returns a message instead of throwing", async () => {
  const result = await likeOrNotGameTool.execute({
    action: "start",
    topic: "nonexistent"
  })
  expect(result).toBe("Unknown topic: nonexistent")
})

test("filter narrows the pool by keyword", async () => {
  await likeOrNotGameTool.execute({ action: "start", topic: "movies" })
  const result = (await likeOrNotGameTool.execute({
    action: "filter",
    topic: "movies",
    keyword: "extraterrestrial",
    keep: true
  })) as string
  expect(result).toContain("2 candidates remain")
  expect(result).toContain("Alien")
  expect(result).toContain("Aliens")
})

test("filter without a prior start lazily loads the topic's pool", async () => {
  const result = (await likeOrNotGameTool.execute({
    action: "filter",
    topic: "movies",
    keyword: "extraterrestrial",
    keep: true
  })) as string
  expect(result).toContain("Alien")
})

test("filter that narrows the pool to exactly one candidate auto-confirms it with rating 'like'", async () => {
  await likeOrNotGameTool.execute({ action: "start", topic: "movies" })
  const result = (await likeOrNotGameTool.execute({
    action: "filter",
    topic: "movies",
    keyword: "parisian",
    keep: true
  })) as string
  expect(result).toBe(
    "Narrowed to one match and saved: Amelie (like). It will be remembered across sessions."
  )

  const recall = (await likeOrNotGameTool.execute({
    action: "recall",
    topic: "movies"
  })) as string
  expect(recall).toContain("Amelie")
  expect(recall).toContain("(like, confirmed ")
})

test("filter narrowing to what's left via keep=false does NOT mark the remaining pool as liked", async () => {
  await likeOrNotGameTool.execute({ action: "start", topic: "movies" })
  // Discarding "extraterrestrial" matches (Alien, Aliens — a small, targeted
  // exclusion) leaves the other 7 remaining; keep=false only ever persists
  // the discarded matches as disliked, never treats what's left as liked.
  const result = (await likeOrNotGameTool.execute({
    action: "filter",
    topic: "movies",
    keyword: "extraterrestrial",
    keep: false
  })) as string
  expect(result).toContain("7 candidates remain")

  const recall = (await likeOrNotGameTool.execute({
    action: "recall",
    topic: "movies"
  })) as string
  expect(recall).not.toContain("(like,")
  expect(recall).not.toContain("Amelie:")
})

test("filter with keyword+keep=false and a small match count (<= 5) bulk-saves every match as 'dislike'", async () => {
  await likeOrNotGameTool.execute({ action: "start", topic: "movies" })
  // "extraterrestrial" matches exactly 2 entries: Alien, Aliens.
  await likeOrNotGameTool.execute({
    action: "filter",
    topic: "movies",
    keyword: "extraterrestrial",
    keep: false
  })

  const recall = (await likeOrNotGameTool.execute({
    action: "recall",
    topic: "movies"
  })) as string
  expect(recall).toContain("Alien:")
  expect(recall).toContain("Aliens:")
  expect(recall.split("\n")).toHaveLength(2)
  for (const line of recall.split("\n")) expect(line).toContain("(dislike,")
})

test("filter with keyword+keep=false matching MORE than 5 candidates does NOT bulk-save (too broad a sweep)", async () => {
  await likeOrNotGameTool.execute({ action: "start", topic: "movies" })
  // "horror" matches 6 entries: Saw, Hostel, Terrifier, Sinister, Smile, Insidious.
  const result = (await likeOrNotGameTool.execute({
    action: "filter",
    topic: "movies",
    keyword: "horror",
    keep: false
  })) as string
  expect(result).toContain("3 candidates remain")

  const recall = await likeOrNotGameTool.execute({
    action: "recall",
    topic: "movies"
  })
  expect(recall).toBe("No results saved yet.")
})

test("filter with a candidate name and keep=false auto-confirms it as 'dislike' and removes it from the pool", async () => {
  await likeOrNotGameTool.execute({ action: "start", topic: "movies" })
  const result = (await likeOrNotGameTool.execute({
    action: "filter",
    topic: "movies",
    name: "Alien",
    keep: false
  })) as string
  expect(result).toBe(
    "Saved: Alien (dislike). It will be remembered across sessions."
  )

  const recall = (await likeOrNotGameTool.execute({
    action: "recall",
    topic: "movies"
  })) as string
  expect(recall).toContain("Alien")
  expect(recall).toContain("(dislike, confirmed ")

  const reveal = (await likeOrNotGameTool.execute({
    action: "reveal",
    topic: "movies"
  })) as string
  expect(reveal).not.toContain("Alien:")
})

test("filter with a candidate name and keep=true auto-confirms it as 'like' and removes it from the pool", async () => {
  await likeOrNotGameTool.execute({ action: "start", topic: "movies" })
  const result = (await likeOrNotGameTool.execute({
    action: "filter",
    topic: "movies",
    name: "Amelie",
    keep: true
  })) as string
  expect(result).toBe(
    "Saved: Amelie (like). It will be remembered across sessions."
  )

  const recall = (await likeOrNotGameTool.execute({
    action: "recall",
    topic: "movies"
  })) as string
  expect(recall).toContain("Amelie")
  expect(recall).toContain("(like, confirmed ")
})

test("filter with an unknown candidate name returns a message instead of throwing", async () => {
  await likeOrNotGameTool.execute({ action: "start", topic: "movies" })
  const result = await likeOrNotGameTool.execute({
    action: "filter",
    topic: "movies",
    name: "Not A Real Movie",
    keep: false
  })
  expect(result).toBe("Unknown candidate: Not A Real Movie")
})

test("filter requires exactly one of keyword or name", async () => {
  await likeOrNotGameTool.execute({ action: "start", topic: "movies" })
  const neither = await likeOrNotGameTool.execute({
    action: "filter",
    topic: "movies",
    keep: true
  })
  expect(neither).toBe(
    "Error: provide exactly one of 'keyword' or 'name' for filter."
  )

  const both = await likeOrNotGameTool.execute({
    action: "filter",
    topic: "movies",
    keyword: "alien",
    name: "Alien",
    keep: true
  })
  expect(both).toBe(
    "Error: provide exactly one of 'keyword' or 'name' for filter, not both."
  )
})

test("filter by name falls back to the full dataset when the candidate was already narrowed out of the round", async () => {
  await likeOrNotGameTool.execute({ action: "start", topic: "movies" })
  // Narrow the round down to just Amelie first.
  await likeOrNotGameTool.execute({
    action: "filter",
    topic: "movies",
    keyword: "parisian",
    keep: true
  })
  // Alien is no longer in the round's pool, but the user can still react to
  // it by name — the description must still resolve from the full dataset.
  const result = await likeOrNotGameTool.execute({
    action: "filter",
    topic: "movies",
    name: "Alien",
    keep: false
  })
  expect(result).toBe(
    "Saved: Alien (dislike). It will be remembered across sessions."
  )
})

test("confirm persists a pick with its rating, recall surfaces it, scoped per topic", async () => {
  const confirmResult = await likeOrNotGameTool.execute({
    action: "confirm",
    topic: "movies",
    name: "Alien",
    rating: "love"
  })
  expect(confirmResult).toContain("Saved: Alien (love)")

  const recall = (await likeOrNotGameTool.execute({
    action: "recall",
    topic: "movies"
  })) as string
  expect(recall).toContain("Alien")
  expect(recall).toContain("(love, confirmed ")

  // A different topic's recall must not see it.
  const otherTopicRecall = await likeOrNotGameTool.execute({
    action: "recall",
    topic: "filtered"
  })
  expect(otherTopicRecall).toBe("No results saved yet.")
})

test("confirm on an unknown candidate name returns a message", async () => {
  const result = await likeOrNotGameTool.execute({
    action: "confirm",
    topic: "movies",
    name: "Not A Real Movie",
    rating: "like"
  })
  expect(result).toBe("Unknown candidate: Not A Real Movie")
})

test("confirm without a rating returns a message instead of throwing", async () => {
  const result = await likeOrNotGameTool.execute({
    action: "confirm",
    topic: "movies",
    name: "Alien"
  } as Parameters<typeof likeOrNotGameTool.execute>[0])
  expect(result).toBe(
    "Error: 'rating' is required for confirm, one of: love, like, neutral, dislike, hate."
  )
})

test("re-confirming the same candidate with a different rating updates it in place", async () => {
  await likeOrNotGameTool.execute({
    action: "confirm",
    topic: "movies",
    name: "Alien",
    rating: "dislike"
  })
  await likeOrNotGameTool.execute({
    action: "confirm",
    topic: "movies",
    name: "Alien",
    rating: "hate"
  })

  const recall = (await likeOrNotGameTool.execute({
    action: "recall",
    topic: "movies"
  })) as string
  const alienLines = recall
    .split("\n")
    .filter((line) => line.startsWith("Alien:"))
  expect(alienLines).toHaveLength(1)
  expect(alienLines[0]).toContain("(hate, confirmed ")
})

test("unconfirm removes a saved pick", async () => {
  await likeOrNotGameTool.execute({
    action: "confirm",
    topic: "movies",
    name: "Alien",
    rating: "like"
  })
  const result = await likeOrNotGameTool.execute({
    action: "unconfirm",
    topic: "movies",
    name: "Alien"
  })
  expect(result).toContain("Removed Alien")

  const recall = await likeOrNotGameTool.execute({
    action: "recall",
    topic: "movies"
  })
  expect(recall).toBe("No results saved yet.")
})

test("unconfirm on a name that wasn't saved returns a message instead of throwing", async () => {
  const result = await likeOrNotGameTool.execute({
    action: "unconfirm",
    topic: "movies",
    name: "Alien"
  })
  expect(result).toBe("Alien wasn't in the saved results.")
})

test("reveal returns the pool when small, and requires a prior start", async () => {
  const noStart = await likeOrNotGameTool.execute({
    action: "reveal",
    topic: "movies"
  })
  expect(noStart).toBe("No candidates loaded — call 'start' first.")

  await likeOrNotGameTool.execute({ action: "start", topic: "movies" })
  const reveal = (await likeOrNotGameTool.execute({
    action: "reveal",
    topic: "movies"
  })) as string
  expect(reveal).toContain("Alien")
  expect(reveal).toContain("Amelie")
})

test("reset clears round state without affecting confirmed results", async () => {
  await likeOrNotGameTool.execute({ action: "start", topic: "movies" })
  await likeOrNotGameTool.execute({
    action: "confirm",
    topic: "movies",
    name: "Alien",
    rating: "like"
  })
  const reset = await likeOrNotGameTool.execute({
    action: "reset",
    topic: "movies"
  })
  expect(reset).toContain("Round state cleared")

  const reveal = await likeOrNotGameTool.execute({
    action: "reveal",
    topic: "movies"
  })
  expect(reveal).toBe("No candidates loaded — call 'start' first.")

  const recall = (await likeOrNotGameTool.execute({
    action: "recall",
    topic: "movies"
  })) as string
  expect(recall).toContain("Alien")
})

test("the excludeNames/excludeKeywords filter keeps excluded entries out of the round entirely", async () => {
  await likeOrNotGameTool.execute({ action: "start", topic: "filtered" })
  const reveal = (await likeOrNotGameTool.execute({
    action: "reveal",
    topic: "filtered"
  })) as string
  expect(reveal).toContain("Allowed")
  expect(reveal).not.toContain("Banned By Name")
  expect(reveal).not.toContain("Banned By Keyword")
})

test("filter persists the narrowed pool to the game_rounds table after every call", async () => {
  await likeOrNotGameTool.execute({ action: "start", topic: "movies" })
  await likeOrNotGameTool.execute({
    action: "filter",
    topic: "movies",
    keyword: "parisian",
    keep: true
  })

  const database = await getDb()
  const row = database
    .query("SELECT remaining FROM game_rounds WHERE topic = $topic")
    .get({ $topic: "movies" }) as { remaining: string }
  const persisted = JSON.parse(row.remaining) as { name: string }[]
  expect(persisted.map((e) => e.name)).toEqual(["Amelie"])
})

test("round progress survives a fresh process (module re-import), not just confirmed results", async () => {
  await likeOrNotGameTool.execute({ action: "start", topic: "movies" })
  await likeOrNotGameTool.execute({
    action: "filter",
    topic: "movies",
    keyword: "parisian",
    keep: true
  })

  // Import only lib/memory-store.ts here, not tools/like-or-not.ts: the tool
  // pulls in lib/agents.ts -> lib/openai.ts, which calls config() at module
  // load and process.exit(1)s without a real config.json — irrelevant to
  // what this test verifies (that game_rounds actually persisted to disk).
  const result =
    await Bun.$`XDG_DATA_HOME=${process.env.XDG_DATA_HOME} bun -e ${`
      import { loadGameRound } from "${join(import.meta.dir, "../../lib/memory-store.ts")}"
      console.log(JSON.stringify(await loadGameRound("movies")))
    `}`.text()

  expect(JSON.parse(result.trim())).toEqual([
    {
      name: "Amelie",
      description: "A whimsical Parisian woman changes lives around her."
    }
  ])
})

test("similar ranks other confirmed candidates across all topics by cosine similarity, with a header showing the query's own rating", async () => {
  vectorOverrides = {
    "Alien: A crew encounters a deadly extraterrestrial.": [1, 0, 0],
    "Aliens: Marines return to the extraterrestrial-infested colony.": [
      0.9, 0.1, 0
    ],
    "Amelie: A whimsical Parisian woman changes lives around her.": [
      0.5, 0.5, 0
    ],
    "Allowed: A perfectly fine entry.": [0.8, 0.2, 0]
  }

  await likeOrNotGameTool.execute({
    action: "confirm",
    topic: "movies",
    name: "Alien",
    rating: "love"
  })
  await likeOrNotGameTool.execute({
    action: "confirm",
    topic: "movies",
    name: "Aliens",
    rating: "like"
  })
  await likeOrNotGameTool.execute({
    action: "confirm",
    topic: "movies",
    name: "Amelie",
    rating: "neutral"
  })
  await likeOrNotGameTool.execute({
    action: "confirm",
    topic: "filtered",
    name: "Allowed",
    rating: "like"
  })

  const result = (await likeOrNotGameTool.execute({
    action: "similar",
    topic: "movies",
    name: "Alien"
  })) as string
  const lines = result.split("\n")

  // Header line first, showing the query's own rating.
  expect(lines[0]).toBe("Alien (love) — similar confirmed picks:")
  // Then closest to Alien's [1,0,0]: Aliens ([0.9,0.1,0], same topic)
  // first, then Allowed ([0.8,0.2,0], a DIFFERENT topic — proving
  // cross-topic search works), Amelie ([0.5,0.5,0]) last.
  expect(lines[1]).toContain("movies/Aliens")
  expect(lines[2]).toContain("filtered/Allowed")
  expect(lines[3]).toContain("movies/Amelie")
  expect(result).not.toContain("movies/Alien:")
})

test("similar excludes dislike/hate candidates by default, includes them with includeDisliked", async () => {
  vectorOverrides = {
    "Alien: A crew encounters a deadly extraterrestrial.": [1, 0, 0],
    "Aliens: Marines return to the extraterrestrial-infested colony.": [
      0.9, 0.1, 0
    ]
  }

  await likeOrNotGameTool.execute({
    action: "confirm",
    topic: "movies",
    name: "Alien",
    rating: "love"
  })
  await likeOrNotGameTool.execute({
    action: "confirm",
    topic: "movies",
    name: "Aliens",
    rating: "hate"
  })

  const excluded = (await likeOrNotGameTool.execute({
    action: "similar",
    topic: "movies",
    name: "Alien"
  })) as string
  expect(excluded).toBe("No other confirmed results to compare against.")

  const included = (await likeOrNotGameTool.execute({
    action: "similar",
    topic: "movies",
    name: "Alien",
    includeDisliked: true
  })) as string
  expect(included).toContain("movies/Aliens")
  expect(included).toContain("(hate,")
})

test("similar excludes the query candidate itself from the results", async () => {
  await likeOrNotGameTool.execute({
    action: "confirm",
    topic: "movies",
    name: "Alien",
    rating: "love"
  })
  const result = (await likeOrNotGameTool.execute({
    action: "similar",
    topic: "movies",
    name: "Alien"
  })) as string
  expect(result).toBe("No other confirmed results to compare against.")
})

test("similar on a candidate that hasn't been confirmed returns a message instead of throwing", async () => {
  const result = await likeOrNotGameTool.execute({
    action: "similar",
    topic: "movies",
    name: "Alien"
  })
  expect(result).toBe(
    'Alien hasn\'t been confirmed yet in "movies" — nothing to compare against.'
  )
})

test("recommend ranks unrated candidates by similarity to loved/liked picks, ignoring dislikes", async () => {
  vectorOverrides = {
    "Alien: A crew encounters a deadly extraterrestrial.": [1, 0, 0],
    // Unrated candidates, scored against Alien's [1,0,0]:
    "Aliens: Marines return to the extraterrestrial-infested colony.": [
      0.9, 0.1, 0
    ],
    "Amelie: A whimsical Parisian woman changes lives around her.": [0, 1, 0],
    "Saw: Two men wake up trapped in a room by a horror puzzle-maker.": [
      0, 0, 1
    ]
  }

  await likeOrNotGameTool.execute({
    action: "confirm",
    topic: "movies",
    name: "Alien",
    rating: "love"
  })

  const result = (await likeOrNotGameTool.execute({
    action: "recommend",
    topic: "movies"
  })) as string
  const lines = result.split("\n")

  // Aliens ([0.9,0.1,0]) is closest to loved Alien ([1,0,0]), ranked first.
  expect(lines[0]).toContain("Aliens:")
  expect(lines[0]).toContain("% similar to your liked picks")
  // Alien itself (already rated) must never appear as a recommendation.
  expect(result).not.toContain("Alien:")
})

test("recommend returns a message when there are no loved/liked picks yet", async () => {
  await likeOrNotGameTool.execute({
    action: "confirm",
    topic: "movies",
    name: "Alien",
    rating: "dislike"
  })
  const result = await likeOrNotGameTool.execute({
    action: "recommend",
    topic: "movies"
  })
  expect(result).toBe(
    'No loved or liked picks yet in "movies" to base recommendations on.'
  )
})

test("recommend returns a message when every candidate is already rated", async () => {
  const dataset = await import("../../lib/datasets").then((m) =>
    m.loadDataset("movies")
  )
  for (const entry of dataset!.entries) {
    await likeOrNotGameTool.execute({
      action: "confirm",
      topic: "movies",
      name: entry.name,
      rating: "like"
    })
  }
  const result = await likeOrNotGameTool.execute({
    action: "recommend",
    topic: "movies"
  })
  expect(result).toBe(
    'Every candidate in "movies" has already been rated — nothing left to recommend.'
  )
})

test("recommend does not write anything to game_results (read-only)", async () => {
  await likeOrNotGameTool.execute({
    action: "confirm",
    topic: "movies",
    name: "Alien",
    rating: "love"
  })
  await likeOrNotGameTool.execute({ action: "recommend", topic: "movies" })

  const recall = (await likeOrNotGameTool.execute({
    action: "recall",
    topic: "movies"
  })) as string
  // Only the one explicit confirm — recommend must not have saved anything.
  expect(recall.split("\n")).toHaveLength(1)
  expect(recall).toContain("Alien")
})

test("recommend on an unknown topic returns a message instead of throwing", async () => {
  const result = await likeOrNotGameTool.execute({
    action: "recommend",
    topic: "nonexistent"
  })
  expect(result).toBe("Unknown topic: nonexistent")
})
