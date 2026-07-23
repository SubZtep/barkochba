import { tool } from "../lib/agents"
import { loadDataset, loadDatasets } from "../lib/datasets"
import { cosineSimilarity, embed } from "../lib/embeddings"
import {
  clearGameRound,
  confirmGameResult,
  type GameRating,
  listAllGameResults,
  listGameResults,
  loadGameRound,
  saveGameRound,
  unconfirmGameResult
} from "../lib/memory-store"

const MAX_SAMPLE = 5
const SIMILAR_TOP_N = 5
const RATINGS: GameRating[] = ["love", "like", "neutral", "dislike", "hate"]

type Args =
  | { action: "list_topics" }
  | { action: "start"; topic: string }
  | {
      action: "filter"
      topic: string
      keyword?: string
      name?: string
      keep: boolean
    }
  | { action: "confirm"; topic: string; name: string; rating: GameRating }
  | { action: "unconfirm"; topic: string; name: string }
  | { action: "recall"; topic: string }
  | { action: "reveal"; topic: string }
  | { action: "reset"; topic: string }
  | {
      action: "similar"
      topic: string
      name: string
      includeDisliked?: boolean
    }
  | { action: "recommend"; topic: string }

/**
 * Twenty-Questions-style "like or not" game: narrows a topic's candidate
 * pool by keyword filtering, then persists confirmed picks across sessions.
 * Topic-agnostic — each topic is a dataset file under
 * ~/.config/kaja/datasets/ (see lib/datasets.ts), so the same game engine
 * works for any subject, not just one hardcoded dataset.
 */
export const likeOrNotGameTool = tool<Args>({
  name: "like_or_not_game",
  description:
    "Play a Twenty-Questions-style game narrowing down candidates from a " +
    "topic's dataset, persisting confirmed results across sessions. " +
    "Actions: 'list_topics' lists available topics — call this first if " +
    "you don't know which topics exist; 'start' loads a topic's pool and " +
    "begins a round; 'filter' narrows the remaining pool and returns how " +
    "many candidates remain — always tell the user this count in your " +
    "reply (e.g. 'down to 12 left') before asking the next question, so " +
    "they can feel the game actually narrowing instead of an endless " +
    "unnumbered stream of questions. It narrows the pool in one of two " +
    "ways — EITHER a keyword match against name+description (keep=true " +
    "keeps matches, keep=false discards them), used after a yes/no/unsure " +
    "answer about a theme, picking a keyword from what was just asked " +
    "about; OR an exact candidate name instead of a keyword, used whenever " +
    "the user reacts to one specific named candidate (not a theme) — " +
    "keep=true means they like it, keep=false means they don't — and this " +
    "immediately and automatically saves that one candidate to confirmed " +
    "results (rating='like' for keep=true, rating='dislike' for " +
    "keep=false) and removes it from the pool, no separate 'confirm' call " +
    "needed; if a keyword filter with keep=true narrows the pool down to " +
    "exactly one candidate, that candidate is likewise automatically saved " +
    "with rating='like' — but present it to the user as a question ('Is it " +
    "X?') and wait for their confirmation before treating it as settled, " +
    "don't just declare it as the answer; if they say no, immediately fix " +
    "the wrongly-saved record with 'unconfirm' (or 'confirm' with the " +
    "right rating if they clarify what it actually was) rather than " +
    "leaving the incorrect guess saved; if a keyword filter with " +
    "keep=false matches a small set of candidates (5 or fewer) — a real " +
    "theme the user said no " +
    "to, e.g. 'pain' — every matched candidate is automatically saved with " +
    "rating='dislike' too (a broader keyword matching more than 5 is " +
    "treated as an exploratory search sweep, not a specific reaction, so " +
    "it only narrows the pool without bulk-saving — keep keywords narrow " +
    "and specific to the theme the user actually reacted to if you want " +
    "the dislike recorded). Call 'confirm' afterward on any of these to " +
    "upgrade/downgrade to love/neutral/hate if the user expresses stronger " +
    "feeling than plain like/dislike; " +
    "'confirm' saves a specific candidate (by exact name) with any of the " +
    "five ratings directly — use this instead of 'filter' when there's no " +
    "round in progress, or the user wants to set a rating stronger/weaker " +
    "than plain like/dislike (love/neutral/hate); do NOT call 'unconfirm' " +
    "to express dislike — that erases the record entirely instead of " +
    "recording the negative opinion; 'unconfirm' is only for retracting a " +
    "previous save by exact name (the user says 'forget that' or made a " +
    "mistake); 'recall' lists everything confirmed for a " +
    "topic, with its rating, from this or any past round — call this at the start of a " +
    "session if the user asks what they've confirmed before, or to avoid " +
    "re-asking about something already settled; 'reveal' returns the full remaining " +
    "candidate list for the current round (only call once it's small, " +
    "roughly 10 or fewer — otherwise you'll get a count instead); 'reset' " +
    "clears the current round's in-progress state for a topic (does not " +
    "affect confirmed/saved results). Round progress is saved after every " +
    "'filter' call, so a round survives a restart — 'start' is only needed " +
    "to begin a fresh round or restart one from scratch; 'similar' takes a " +
    "confirmed candidate (by exact name) and finds the most semantically " +
    "similar OTHER confirmed candidates across ALL topics, ranked by " +
    "meaning rather than keyword overlap — use this when the user asks " +
    "what else they might like based on something they've already " +
    "confirmed (e.g. 'what else have I loved that's like this'); by " +
    "default it excludes candidates rated dislike/hate (the usual intent " +
    "is 'what else might I like'), pass includeDisliked=true to include " +
    "them too (e.g. 'what similar things have I rejected'); 'recommend' " +
    "finds UNRATED candidates in one topic — ones the user hasn't reacted " +
    "to yet — that are most similar to what they've loved/liked so far in " +
    "that topic, for when the user asks what else they might want to try " +
    "(distinct from 'similar', which only ever compares among already-" +
    "confirmed picks).",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "list_topics",
          "start",
          "filter",
          "confirm",
          "unconfirm",
          "recall",
          "reveal",
          "reset",
          "similar",
          "recommend"
        ],
        description: "Which game action to perform"
      },
      topic: {
        type: "string",
        description:
          "Required for every action except 'list_topics'. Exact topic id from 'list_topics'."
      },
      keyword: {
        type: "string",
        description:
          "For 'filter' when narrowing by theme (not a specific named " +
          "candidate). A lowercase word or phrase to match against " +
          "candidate name+description, e.g. 'pain', 'control', 'clothing'. " +
          "Keep it narrow and specific to what the user actually reacted " +
          "to — with keep=false, a match of 5 or fewer candidates gets " +
          "each one saved as disliked, but a broad multi-word sweep " +
          "matching many entries only narrows the pool without saving " +
          "anything. Provide exactly one of keyword or name for 'filter'."
      },
      keep: {
        type: "boolean",
        description:
          "Required for 'filter'. With keyword: true = keep only matches " +
          "(user said yes to the theme); false = discard matches (user " +
          "said no) — and if 5 or fewer candidates matched, each is also " +
          "saved as disliked. With name: true = user likes this candidate, " +
          "false = user doesn't — either way it's saved immediately."
      },
      name: {
        type: "string",
        description:
          "For 'filter', when the user reacts to one specific named " +
          "candidate instead of a theme (provide exactly one of keyword or " +
          "name). Also required for 'confirm', 'unconfirm', and 'similar' " +
          "(the confirmed candidate to find similar ones for). Exact " +
          "candidate name."
      },
      rating: {
        type: "string",
        enum: RATINGS,
        description:
          "Required for 'confirm'. How the user feels about this candidate."
      },
      includeDisliked: {
        type: "boolean",
        description:
          "Optional for 'similar'. When true, also includes candidates " +
          "rated dislike/hate in the results — by default they're " +
          "excluded, since the intent is usually 'what else might I like'."
      }
    },
    required: ["action"]
  },
  execute: async (args) => {
    if (args.action === "list_topics") {
      const datasets = await loadDatasets()
      if (datasets.size === 0) return "(no topics configured)"
      return [...datasets.entries()]
        .map(([topic, dataset]) => `${topic}: ${dataset.label}`)
        .join("\n")
    }

    switch (args.action) {
      case "start": {
        const dataset = await loadDataset(args.topic)
        if (!dataset) return `Unknown topic: ${args.topic}`
        await saveGameRound(args.topic, dataset.entries)
        return `Round started for "${args.topic}". ${dataset.entries.length} candidates loaded.`
      }

      case "filter": {
        if (typeof args.keep !== "boolean")
          return "Error: 'keep' (boolean) is required for filter."
        if (!args.keyword && !args.name)
          return "Error: provide exactly one of 'keyword' or 'name' for filter."
        if (args.keyword && args.name)
          return "Error: provide exactly one of 'keyword' or 'name' for filter, not both."

        let pool = await loadGameRound(args.topic)
        if (!pool) {
          const dataset = await loadDataset(args.topic)
          if (!dataset) return `Unknown topic: ${args.topic}`
          pool = dataset.entries
        }

        // Reacting to one specific named candidate (not a theme): save the
        // reaction immediately — like for keep=true, dislike for keep=false
        // — and drop just that candidate from the pool. This is the
        // structural fix for negative opinions: naming a specific dislike
        // must persist it the same way narrowing to a single "yes" does,
        // rather than relying on the model to remember a separate 'confirm'
        // call that may never come.
        if (args.name) {
          let entry = pool.find((candidate) => candidate.name === args.name)
          if (!entry) {
            // Not in the current (possibly already-narrowed) round pool —
            // fall back to the full dataset, since the user may be reacting
            // to a candidate outside today's narrowed view.
            const dataset = await loadDataset(args.topic)
            entry = dataset?.entries.find(
              (candidate) => candidate.name === args.name
            )
          }
          if (!entry) return `Unknown candidate: ${args.name}`
          const rating: GameRating = args.keep ? "like" : "dislike"
          const [vector] = await embed(`${entry.name}: ${entry.description}`)
          await confirmGameResult(
            args.topic,
            entry.name,
            entry.description,
            rating,
            vector!
          )
          const next = pool.filter((candidate) => candidate.name !== args.name)
          await saveGameRound(args.topic, next)
          return `Saved: ${entry.name} (${rating}). It will be remembered across sessions.`
        }

        const needle = args.keyword!.toLowerCase()
        const matches = pool.filter((entry) =>
          `${entry.name} ${entry.description}`.toLowerCase().includes(needle)
        )
        const next = args.keep
          ? matches
          : pool.filter((entry) => !matches.includes(entry))
        await saveGameRound(args.topic, next)

        // Excluding a small, targeted set of candidates by keyword (a real
        // theme the user said no to, e.g. "pain") persists each of them as
        // disliked — the same durable-record principle as auto-confirming a
        // narrowed-to-one "yes". Capped at MAX_SAMPLE: a keyword matching
        // more than that signals a broad exploratory sweep (the model
        // casting a wide net across many unrelated entries), not a specific
        // reaction, so it only narrows the pool without bulk-persisting.
        if (!args.keep && matches.length > 0 && matches.length <= MAX_SAMPLE) {
          const vectors = await embed(
            matches.map((entry) => `${entry.name}: ${entry.description}`)
          )
          for (let i = 0; i < matches.length; i++) {
            const entry = matches[i]!
            await confirmGameResult(
              args.topic,
              entry.name,
              entry.description,
              "dislike",
              vectors[i]!
            )
          }
        }

        if (next.length === 0)
          return "No candidates remain. Consider a 'reset' or broadening the last question."

        // A 'yes' filter that narrows to exactly one candidate is treated as
        // an implicit confirm: persisted to game_results immediately, rather
        // than waiting for a separate 'confirm' call that might never come
        // if the app stops before the model gets to it. Defaults to "like"
        // (a plain positive, not the strongest rating) since a keyword
        // match only signals yes/no, not intensity — call 'confirm'
        // afterward to upgrade/downgrade if the user feels more strongly.
        if (args.keep && next.length === 1) {
          const [winner] = next
          const [vector] = await embed(
            `${winner!.name}: ${winner!.description}`
          )
          await confirmGameResult(
            args.topic,
            winner!.name,
            winner!.description,
            "like",
            vector!
          )
          return `Narrowed to one match and saved: ${winner!.name} (like). It will be remembered across sessions.`
        }

        const sample = next
          .slice(0, MAX_SAMPLE)
          .map((entry) => entry.name)
          .join(", ")
        return (
          `${next.length} candidates remain` +
          (next.length <= MAX_SAMPLE
            ? `: ${sample}.`
            : ` (sample: ${sample}, ...).`)
        )
      }

      case "confirm": {
        if (!args.name) return "Error: 'name' is required for confirm."
        if (!args.rating || !RATINGS.includes(args.rating))
          return `Error: 'rating' is required for confirm, one of: ${RATINGS.join(", ")}.`
        const dataset = await loadDataset(args.topic)
        const entry = dataset?.entries.find(
          (candidate) => candidate.name === args.name
        )
        if (!entry) return `Unknown candidate: ${args.name}`
        const [vector] = await embed(`${entry.name}: ${entry.description}`)
        await confirmGameResult(
          args.topic,
          entry.name,
          entry.description,
          args.rating,
          vector!
        )
        return `Saved: ${entry.name} (${args.rating}). It will be remembered across sessions.`
      }

      case "unconfirm": {
        if (!args.name) return "Error: 'name' is required for unconfirm."
        const removed = await unconfirmGameResult(args.topic, args.name)
        return removed
          ? `Removed ${args.name} from saved results.`
          : `${args.name} wasn't in the saved results.`
      }

      case "recall": {
        const rows = await listGameResults(args.topic)
        if (rows.length === 0) return "No results saved yet."
        return rows
          .map(
            (row) =>
              `${row.name}: ${row.description} (${row.rating}, confirmed ${row.confirmedAt.slice(0, 10)})`
          )
          .join("\n")
      }

      case "reveal": {
        const pool = await loadGameRound(args.topic)
        if (!pool) return "No candidates loaded — call 'start' first."
        if (pool.length > 10)
          return (
            `${pool.length} candidates still remain — too many to reveal. ` +
            "Keep narrowing with 'filter'."
          )
        return pool
          .map((entry) => `${entry.name}: ${entry.description}`)
          .join("\n")
      }

      case "reset": {
        await clearGameRound(args.topic)
        return "Round state cleared. Saved results are unaffected."
      }

      case "similar": {
        if (!args.name) return "Error: 'name' is required for similar."
        const all = await listAllGameResults()
        const query = all.find(
          (row) => row.topic === args.topic && row.name === args.name
        )
        if (!query)
          return `${args.name} hasn't been confirmed yet in "${args.topic}" — nothing to compare against.`

        const ranked = all
          .filter(
            (row) => !(row.topic === query.topic && row.name === query.name)
          )
          .filter(
            (row) =>
              args.includeDisliked ||
              (row.rating !== "dislike" && row.rating !== "hate")
          )
          .map((row) => ({
            row,
            score: cosineSimilarity(query.embedding, row.embedding)
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, SIMILAR_TOP_N)

        if (ranked.length === 0)
          return "No other confirmed results to compare against."

        const lines = ranked.map(
          ({ row, score }) =>
            `${row.topic}/${row.name}: ${row.description} (${row.rating}, ${Math.round(score * 100)}% similar)`
        )
        return [
          `${query.name} (${query.rating}) — similar confirmed picks:`,
          ...lines
        ].join("\n")
      }

      case "recommend": {
        const dataset = await loadDataset(args.topic)
        if (!dataset) return `Unknown topic: ${args.topic}`

        const confirmed = await listGameResults(args.topic)
        const confirmedNames = new Set(confirmed.map((row) => row.name))
        const lovedLiked = confirmed.filter(
          (row) => row.rating === "love" || row.rating === "like"
        )
        if (lovedLiked.length === 0)
          return `No loved or liked picks yet in "${args.topic}" to base recommendations on.`

        const unrated = dataset.entries.filter(
          (entry) => !confirmedNames.has(entry.name)
        )
        if (unrated.length === 0)
          return `Every candidate in "${args.topic}" has already been rated — nothing left to recommend.`

        // Reuse the loved/liked picks' already-stored embeddings (computed
        // at confirm-time) instead of re-embedding their text — only the
        // unrated pool needs a fresh (batched) embedding call.
        const all = await listAllGameResults()
        const lovedLikedEmbeddings = lovedLiked.map(
          (row) =>
            all.find((r) => r.topic === args.topic && r.name === row.name)!
              .embedding
        )
        const unratedVectors = await embed(
          unrated.map((entry) => `${entry.name}: ${entry.description}`)
        )

        const ranked = unrated
          .map((entry, i) => ({
            entry,
            score: Math.max(
              ...lovedLikedEmbeddings.map((e) =>
                cosineSimilarity(unratedVectors[i]!, e)
              )
            )
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, SIMILAR_TOP_N)

        return ranked
          .map(
            ({ entry, score }) =>
              `${entry.name}: ${entry.description} (${Math.round(score * 100)}% similar to your liked picks)`
          )
          .join("\n")
      }

      default:
        return `Unknown action: ${(args as { action: string }).action}`
    }
  }
})
