import { expect, test } from "bun:test"
import { describeToolCall } from "../../lib/tool-labels"

test("describes a known tool call in plain language", () => {
  expect(
    describeToolCall("web_search", JSON.stringify({ query: "puppies" }))
  ).toBe('Searching "puppies"...')
})

test("omits the optional timezone when absent", () => {
  expect(describeToolCall("current_time", JSON.stringify({}))).toBe(
    "Checking the time..."
  )
})

test("includes the optional timezone when present", () => {
  expect(
    describeToolCall(
      "current_time",
      JSON.stringify({ timezone: "America/New_York" })
    )
  ).toBe("Checking the time (America/New_York)...")
})

test("falls back to raw args for an unknown tool", () => {
  const args = JSON.stringify({ foo: "bar" })
  expect(describeToolCall("mcp_some_tool", args)).toBe(`mcp_some_tool(${args})`)
})

test("falls back to raw args when JSON is malformed", () => {
  expect(describeToolCall("web_search", "{not json")).toBe(
    "web_search({not json)"
  )
})
