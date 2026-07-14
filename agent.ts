import { color } from "bun"
import { currentTimeTool, readFileTool } from "./lib/agent-tools"
import { Agent, askUserTool, createSession, run } from "./lib/agents"

const agent = new Agent({
  model: process.env.OPENAI_API_MODEL!,
  tools: [readFileTool, currentTimeTool, askUserTool]
})

console.log(`${color("magenta", "ansi")}${agent.model}`)

const session = createSession()
const lines = console[Symbol.asyncIterator]()

async function nextLine(): Promise<string | null> {
  process.stdout.write("> ")
  const { value: line, done } = await lines.next()
  return done ? null : line.trim()
}

let prompt = process.argv.slice(2).join(" ")

while (true) {
  if (!prompt) {
    const line = await nextLine()
    if (line === null) break
    if (/^(exit|quit)$/i.test(line)) break
    if (!line) continue
    prompt = line
  }

  let asked = false
  for await (const event of run(agent, prompt, session)) {
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
      case "ask_user":
        console.log(`${color("cyan", "ansi")}? ${event.question}`)
        asked = true
        break
    }
  }

  // A final without ask_user means the task is done — exit instead of
  // prompting. Input is only read to answer the agent's question.
  if (!asked) break
  prompt = ""
}

// Reading stdin keeps the event loop alive even after the loop breaks.
process.exit(0)
