import { Agent, run, setDefaultOpenAIClient, setOpenAIAPI, tool } from "@openai/agents"
import { z } from "zod"
import { client } from "./lib/openai"

setDefaultOpenAIClient(client)
setOpenAIAPI("chat_completions")

const readFileTool = tool({
	name: "read_file",
	description: "Read a text file",
	parameters: z.object({
		path: z.string().describe("Path to the file")
	}),
	execute: async ({ path }) => await Bun.file(path).text()
})

const color = (code: number, s: string) => `\x1b[${code}m${s}\x1b[0m`
const magenta = (s: string) => color(35, s)
const yellow = (s: string) => color(33, s)
const gray = (s: string) => color(90, s)

async function runAgent(prompt: string) {
	const model = process.env.OPENAI_API_MODEL!
	console.log(magenta(model))

	const agent = new Agent({
		name: "Assistant",
		model,
		tools: [readFileTool]
	})

	const stream = await run(agent, prompt, { stream: true })

	for await (const event of stream) {
		if (event.type !== "run_item_stream_event") continue

		if (event.item.type === "reasoning_item") {
			const text = event.item.rawContent?.map((r) => r.text).join("")
			if (text) console.log(gray(text))
		}

		if (event.item.type === "tool_call_item") {
			const raw = event.item.rawItem
			if (raw.type === "function_call") {
				console.log(yellow(`> ${raw.name}(${raw.arguments})`))
			}
		}
	}

	await stream.completed
	console.log(stream.finalOutput)
}

await runAgent(
	process.argv[2] ??
		"Read package.json and tell me which openai version is installed."
)
