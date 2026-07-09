// The "global brain": persistent conversation memory in SQLite.
// Every exchange is stored and embedded, so future sessions can recall either
// the most recent turns or the turns most semantically relevant to a query.

import { Database } from "bun:sqlite"
import type { ChatMessage } from "./llm"
import { log } from "./logger"
import { client } from "./openai"

const db = new Database(process.env.BRAIN_DB ?? "brain.sqlite")
db.run(`
	CREATE TABLE IF NOT EXISTS turns (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
		content TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	)
`)
try {
	db.run("ALTER TABLE turns ADD COLUMN embedding TEXT")
} catch {
	// column already exists
}

const insert = db.prepare(
	"INSERT INTO turns (role, content, embedding) VALUES (?, ?, ?)"
)
const lastWithRole = db.prepare(
	"SELECT content FROM turns WHERE role = ? ORDER BY id DESC LIMIT 1"
)

async function embed(text: string): Promise<number[]> {
	// Fireworks doesn't honor the SDK's base64 default the way OpenAI does,
	// so request plain floats explicitly.
	const res = await client.embeddings.create({
		model: process.env.OPENAI_API_MODEL_EMBEDDING!,
		input: text,
		encoding_format: "float"
	})
	return res.data[0]!.embedding
}

function cosineSimilarity(a: number[], b: number[]): number {
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

async function rememberTurn(role: "user" | "assistant", content: string) {
	const last = lastWithRole.get(role) as { content: string } | null
	if (last?.content === content) return
	insert.run(role, content, JSON.stringify(await embed(content)))
}

export async function remember(you: string, assistant: string) {
	await rememberTurn("user", you)
	await rememberTurn("assistant", assistant)
}

/** The most recent exchanges, oldest first, ready to seed createChat() history. */
export function recall(limit = 40): ChatMessage[] {
	const rows = db
		.prepare("SELECT role, content FROM turns ORDER BY id DESC LIMIT ?")
		.all(limit) as ChatMessage[]
	rows.reverse()
	if (rows.length > 0)
		log.info({ turns: rows.length }, "brain: recalled history")
	return rows
}

/** Past turns most semantically relevant to `query`, best match first. */
export async function recallRelevant(
	query: string,
	topN = 5
): Promise<{
	matches: (ChatMessage & { score: number })[]
	durationMs: number
	model: string
}> {
	const model = process.env.OPENAI_API_MODEL_EMBEDDING!
	const start = Date.now()
	const rows = db
		.prepare(
			"SELECT role, content, embedding FROM turns WHERE embedding IS NOT NULL"
		)
		.all() as { role: "user" | "assistant"; content: string; embedding: string }[]
	if (!rows.length) return { matches: [], durationMs: Date.now() - start, model }
	const queryEmbedding = await embed(query)
	const scored = rows
		.map((r) => ({
			role: r.role,
			content: r.content,
			score: cosineSimilarity(queryEmbedding, JSON.parse(r.embedding))
		}))
		.sort((a, b) => b.score - a.score)
		.slice(0, topN)
	const durationMs = Date.now() - start
	log.debug(
		{ query, matches: scored.map((s) => ({ content: s.content, score: s.score })) },
		"brain: relevant recall"
	)
	return { matches: scored, durationMs, model }
}
