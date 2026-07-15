import { color } from "bun"
import { Agent, askUserTool, createSession, run } from "./lib/agents"
import { playSound } from "./lib/my-computer"
import { currentTimeTool } from "./tools/current-time"
import { myLocationTool } from "./tools/my-location"
import { readFileTool } from "./tools/read-file"
import { webSearchTool } from "./tools/web-search"

const agent = new Agent({
  model: process.env.OPENAI_API_MODEL!,
  tools: [
    readFileTool,
    currentTimeTool,
    askUserTool,
    webSearchTool,
    myLocationTool
  ]
})

console.log(`${color("deeppink", "ansi")}༼☉ɷ⊙༽ ${agent.model}`)

const session = createSession()
const lines = console[Symbol.asyncIterator]()

async function nextLine(): Promise<string | null> {
  process.stdout.write(color("silver", "ansi")!)
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
        playSound("wind")
        console.log(`${color("rebeccapurple", "ansi")}${event.text}`)
        break
      case "tool_call":
        playSound("magic")
        console.log(
          `${color("peachpuff", "ansi")}> ${event.name}(${event.arguments})`
        )
        break
      case "message":
        console.log(event.content)
        break
      case "ask_user":
        playSound("bell")
        console.log(`${color("yellowgreen", "ansi")}? ${event.question}`)
        asked = true
        break
      case "final":
        playSound("hehe")
        console.log(event.content)
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
