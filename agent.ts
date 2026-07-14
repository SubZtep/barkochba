import type {
	ChatCompletionMessageParam,
	ChatCompletionTool
} from "openai/resources/chat/completions"
import { client } from "./lib/openai"

const tools: ChatCompletionTool[] = [
	{
		type: "function",
		function: {
			name: "read_file",
			description: "Read a text file",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string", description: "Path to the file" }
				},
				required: ["path"]
			}
		}
	}
]

async function executeTool(name: string, args: { path: string }) {
	switch (name) {
		case "read_file":
			return await Bun.file(args.path).text()
		default:
			throw new Error(`Unknown tool: ${name}`)
	}
}

const color = (code: number, s: string) => `\x1b[${code}m${s}\x1b[0m`
const magenta = (s: string) => color(35, s)
const yellow = (s: string) => color(33, s)
const gray = (s: string) => color(90, s)

async function runAgent(prompt: string) {
	const model = process.env.OPENAI_API_MODEL!
	console.log(magenta(model))

	const messages: ChatCompletionMessageParam[] = [
		{ role: "user", content: prompt }
	]

	while (true) {
		console.log("--- NEW ROUND ---")
		const completion = await client.chat.completions.create({
			model,
			messages,
			tools
		})

		const message = completion.choices[0]!.message
		messages.push(message)

		const thinking = (message as { reasoning_content?: string })
			.reasoning_content
		if (thinking) console.log(gray(thinking))

		// Finished?
		if (!message.tool_calls?.length) {
			console.log(message.content)
			return
		}

		// Otherwise execute tool calls
		for (const call of message.tool_calls) {
			if (call.type !== "function") continue
			console.log(yellow(`> ${call.function.name}(${call.function.arguments})`))
			const args = JSON.parse(call.function.arguments)
			messages.push({
				role: "tool",
				tool_call_id: call.id,
				content: await executeTool(call.function.name, args)
			})
		}
	}
}

await runAgent(
	process.argv[2] ??
		"Read package.json and tell me which openai version is installed."
)
