import { expect, test } from "bun:test"
import {
  commit,
  createPromptHistory,
  markEdited,
  recall
} from "../../lib/prompt-history"

test("up walks to the oldest entry and sticks there", () => {
  let h = createPromptHistory(["newest", "older", "oldest"])
  let step = recall(h, -1, "")
  expect(step.value).toBe("newest")
  step = recall(step.history, -1, "")
  expect(step.value).toBe("older")
  step = recall(step.history, -1, "")
  expect(step.value).toBe("oldest")
  // at the oldest entry: no further, history unchanged
  h = step.history
  step = recall(h, -1, "oldest")
  expect(step.value).toBeNull()
  expect(step.history).toBe(h)
})

test("down walks back through entries and restores the draft", () => {
  let step = recall(createPromptHistory(["newest", "older"]), -1, "my draft")
  step = recall(step.history, -1, "newest")
  expect(step.value).toBe("older")
  step = recall(step.history, 1, "older")
  expect(step.value).toBe("newest")
  step = recall(step.history, 1, "newest")
  expect(step.value).toBe("my draft")
  // already on the draft: down is a no-op
  expect(recall(step.history, 1, "my draft").value).toBeNull()
})

test("a manual edit resets the position; next up captures the new draft", () => {
  let step = recall(createPromptHistory(["newest", "older"]), -1, "")
  expect(step.value).toBe("newest")
  // user edits the recalled text — it becomes the live draft
  const edited = markEdited(step.history)
  expect(edited.position).toBe(-1)
  step = recall(edited, -1, "newestX")
  expect(step.value).toBe("newest")
  expect(recall(step.history, 1, "newest").value).toBe("newestX")
})

test("markEdited on the live draft is a no-op", () => {
  const h = createPromptHistory(["a"])
  expect(markEdited(h)).toBe(h)
})

test("commit prepends unless it repeats the newest entry", () => {
  let h = createPromptHistory(["a"])
  h = commit(h, "b")
  expect(h.entries).toEqual(["b", "a"])
  h = commit(h, "b")
  expect(h.entries).toEqual(["b", "a"])
  // a non-consecutive repeat is a new entry, like shell history
  h = commit(h, "a")
  expect(h.entries).toEqual(["a", "b", "a"])
})

test("commit resets position and draft", () => {
  let step = recall(createPromptHistory(["a"]), -1, "draft")
  const h = commit(step.history, "sent")
  expect(h.position).toBe(-1)
  expect(h.draft).toBe("")
  step = recall(h, -1, "")
  expect(step.value).toBe("sent")
})

test("empty history recalls nothing in either direction", () => {
  const h = createPromptHistory([])
  expect(recall(h, -1, "typed").value).toBeNull()
  expect(recall(h, 1, "typed").value).toBeNull()
})
