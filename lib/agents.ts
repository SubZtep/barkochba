import type {
  ChatCompletionMessageParam,
  ChatCompletionTool
} from "openai/resources/chat/completions"
import { client } from "./openai"

/**
 * A tool an {@link Agent} can call, pairing the OpenAI function definition
 * with the local implementation that runs when the model calls it.
 */
export type Tool<Args> = {
  definition: ChatCompletionTool
  execute: (args: Args) => Promise<string>
}

/**
 * Defines a tool from a JSON schema and an executor function.
 *
 * @param config.name - Function name the model uses to call the tool.
 * @param config.description - Description shown to the model.
 * @param config.parameters - JSON schema for the tool's arguments.
 * @param config.execute - Runs when the model calls the tool; receives the
 * parsed arguments and returns the string result to send back as the tool message.
 */
export function tool<Args>(config: {
  name: string
  description: string
  // @ts-expect-error
  parameters: ChatCompletionTool["function"]["parameters"]
  execute: (args: Args) => Promise<string>
}): Tool<Args> {
  return {
    definition: {
      type: "function",
      function: {
        name: config.name,
        description: config.description,
        parameters: config.parameters
      }
    },
    execute: config.execute
  }
}

/**
 * A model plus the tools it's allowed to call.
 */
export class Agent {
  name: string
  model: string
  tools: Tool<any>[]

  constructor(config: {
    name?: string
    model: string
    tools: Tool<any>[]
  }) {
    this.name = config.name ?? "Assistant"
    this.model = config.model
    this.tools = config.tools
  }
}

/**
 * Events yielded by {@link run} as the agent progresses through rounds.
 */
export type AgentEvent =
  | { type: "reasoning"; text: string }
  | { type: "tool_call"; name: string; arguments: string }
  | { type: "final"; content: string | null }

/**
 * Runs an {@link Agent} on a prompt to completion, looping through
 * tool calls until the model returns a final message.
 *
 * Yields an {@link AgentEvent} for each round's reasoning (if the model
 * returns `reasoning_content`), each tool call, and the final message.
 * Callers are responsible for any logging/presentation.
 *
 * @param agent - The agent to run.
 * @param prompt - The user prompt to start the conversation with.
 */
export async function* run(
  agent: Agent,
  prompt: string
): AsyncGenerator<AgentEvent, void, void> {
  const toolsByName = new Map(
    agent.tools.map((t) => [t.definition.function.name, t])
  )
  const definitions = agent.tools.map((t) => t.definition)

  const messages: ChatCompletionMessageParam[] = [
    { role: "user", content: prompt }
  ]

  while (true) {
    const completion = await client.chat.completions.create({
      model: agent.model,
      messages,
      tools: definitions
    })

    const message = completion.choices[0]?.message
    messages.push(message)

    const thinking = (
      message as {
        reasoning_content?: string
      }
    ).reasoning_content
    if (thinking)
      yield {
        type: "reasoning",
        text: thinking
      }

    // Finished?
    if (!message.tool_calls?.length) {
      yield {
        type: "final",
        content: message.content
      }
      return
    }

    // Otherwise execute tool calls
    for (const call of message.tool_calls) {
      if (call.type !== "function") continue
      yield {
        type: "tool_call",
        name: call.function.name,
        arguments: call.function.arguments
      }
      const t = toolsByName.get(call.function.name)
      if (!t) throw new Error(`Unknown tool: ${call.function.name}`)
      const args = JSON.parse(call.function.arguments)
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: await t.execute(args)
      })
    }
  }
}
