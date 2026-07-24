import { expect, test } from "bun:test"
import { TOML } from "bun"
import { McpFileSchema } from "../../schemas/mcp"

const parse = (toml: string) => McpFileSchema.parse(TOML.parse(toml))

test("valid file parses servers with defaults for args/env", () => {
  const toml = `
[[servers]]
id = "playwright"
command = "bunx"
args = ["@playwright/mcp@latest", "--isolated", "--headless"]

[[servers]]
id = "example-with-env"
command = "npx"
args = ["-y", "some-mcp-server"]
env = { API_KEY = "secret" }
`
  expect(parse(toml)).toEqual({
    servers: [
      {
        id: "playwright",
        command: "bunx",
        args: ["@playwright/mcp@latest", "--isolated", "--headless"],
        env: {}
      },
      {
        id: "example-with-env",
        command: "npx",
        args: ["-y", "some-mcp-server"],
        env: { API_KEY: "secret" }
      }
    ]
  })
})

test("empty file parses to no servers", () => {
  expect(parse("")).toEqual({ servers: [] })
})

test("server without command is rejected", () => {
  const toml = `
[[servers]]
id = "broken"
`
  expect(() => parse(toml)).toThrow()
})
