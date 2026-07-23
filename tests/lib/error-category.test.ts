import { expect, test } from "bun:test"
import { APIConnectionError } from "openai"
import { ToolError } from "../../lib/agents"
import { categorizeError } from "../../lib/error-category"

test("categorizes an OpenAI API error as network", () => {
  const error = new APIConnectionError({ message: "connection refused" })
  expect(categorizeError(error)).toEqual({
    category: "network",
    message: "connection refused"
  })
})

test("categorizes a ToolError as tool, prefixed with the tool name", () => {
  const error = new ToolError("fetch_url", "Fetch failed: 404")
  expect(categorizeError(error)).toEqual({
    category: "tool",
    message: "fetch_url: Fetch failed: 404"
  })
})

test("categorizes a plain Error as agent", () => {
  const error = new Error("Unknown tool: foo")
  expect(categorizeError(error)).toEqual({
    category: "agent",
    message: "Unknown tool: foo"
  })
})

test("categorizes a non-Error throw as unknown", () => {
  expect(categorizeError("boom")).toEqual({
    category: "unknown",
    message: "boom"
  })
})
