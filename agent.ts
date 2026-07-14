import { color } from "bun"
import { currentTimeTool, readFileTool } from "./lib/agent-tools"
import { Agent, run } from "./lib/agents"

const agent = new Agent({
  model: process.env.OPENAI_API_MODEL!,
  tools: [readFileTool, currentTimeTool]
})

console.log(`${color("magenta", "ansi")}${agent.model}`)

const prompt =
  process.argv.slice(2).join(" ") ||
  "Read package.json and tell me which openai version is installed."

for await (const event of run(agent, prompt)) {
  switch (event.type) {
    case "reasoning":
      console.log(`${color("grey", "ansi")}${event.text}`)
      break
    case "tool_call":
      console.log(
        `${color("yellow", "ansi")}> ${event.name}(${event.arguments})`
      )
      break
    case "final":
      console.log(event.content)
      break
  }
}
