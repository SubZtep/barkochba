// The "global brain": persistent conversation memory in SQLite.
// Every exchange is stored, and recent ones are replayed into the LLM's
// context on the next session, so the assistant remembers past conversations.

import { Database } from "bun:sqlite"
import type { ChatMessage } from "./llm"
import { log } from "./logger"

const db = new Database(process.env.BRAIN_DB ?? "brain.sqlite")
db.run(`
	CREATE TABLE IF NOT EXISTS turns (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
		content TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	)
`)

const insert = db.prepare("INSERT INTO turns (role, content) VALUES (?, ?)")

export function remember(you: string, assistant: string) {
	insert.run("user", you)
	insert.run("assistant", assistant)
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
