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
  instructions?: string

  constructor(config: {
    name?: string
    model: string
    tools: Tool<any>[]
    instructions?: string
  }) {
    this.name = config.name ?? "Assistant"
    this.model = config.model
    this.tools = config.tools
    this.instructions = config.instructions
  }
}

/**
 * Name of the built-in tool the model calls to pause and ask the human a
 * question, instead of just returning a final message. {@link run} intercepts
 * calls to this tool by name: it doesn't execute like a normal tool, it ends
 * the generator so the caller can collect the human's reply and continue the
 * conversation with it.
 */
export const ASK_USER_TOOL = "ask_user"

/**
 * System-prompt guidance injected by {@link run} when an agent has the
 * {@link askUserTool}. The tool's own description isn't enough for models to
 * spontaneously prefer it over ending a turn with a question in plain text,
 * so this makes the contract explicit.
 */
const ASK_USER_INSTRUCTIONS =
  `You talk to a human through a terminal, and the human can only reply ` +
  `when you call the ${ASK_USER_TOOL} tool — plain text output is shown to ` +
  `them but gives them no way to answer. So EVERY time you expect a reply — ` +
  `a question, a confirmation, their turn in a game (e.g. "Question 3: is ` +
  `it alive?") — deliver it by calling ${ASK_USER_TOOL}. Never write a ` +
  `question as plain text: plain messages are only for statements and ` +
  `results that need no reply, and end the conversation turn. That also ` +
  `means no courtesy closers like "Would you like...?" or "Let me know ` +
  `if..." — the conversation is over the moment you send plain text, so ` +
  `either call ${ASK_USER_TOOL} because you genuinely need an answer, or ` +
  `just state the result and stop.`

/**
 * Tool the model calls to ask the human a question and wait for their reply,
 * instead of ending its turn with a plain final message. Include this in an
 * {@link Agent}'s tools whenever the agent should be able to pause for human
 * input mid-task. Never actually executed — {@link run} intercepts calls to
 * it by name before dispatch.
 */
export const askUserTool = tool<{ question: string }>({
  name: ASK_USER_TOOL,
  description:
    "Ask the human a question and wait for their reply. Use this when you need " +
    "information only they can provide, or when you're done with your current " +
    "thought and it's their turn (e.g. asking your next yes/no question in a " +
    "game). Don't use this just to acknowledge or restate something.",
  parameters: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "The question to ask the human."
      }
    },
    required: ["question"]
  },
  execute: async () => {
    throw new Error(
      `${ASK_USER_TOOL} should be intercepted by run(), not executed`
    )
  }
})

/**
 * Ephemeral token fragment yielded by {@link run} while a completion streams
 * in, before the round's finalized events. `channel` says which part of the
 * message the text belongs to. Presentation-only: consumers may render these
 * for a live-typing effect or ignore them entirely — every round still ends
 * with the same finalized events carrying the complete text.
 */
export type AgentDelta = {
  type: "delta"
  channel: "reasoning" | "content"
  text: string
}

/**
 * Events yielded by {@link run} as the agent progresses through rounds.
 */
export type AgentEvent =
  | AgentDelta
  | { type: "reasoning"; text: string }
  | { type: "tool_call"; name: string; arguments: string }
  | { type: "ask_user"; question: string }
  | { type: "final"; content: string | null }

/**
 * {@link AgentEvent} minus the ephemeral {@link AgentDelta} fragments — the
 * events that make up the permanent conversation timeline.
 */
export type FinalizedAgentEvent = Exclude<AgentEvent, AgentDelta>

/**
 * Conversation state threaded through repeated {@link run} calls: the
 * message history, and the id of a pending {@link ASK_USER_TOOL} call (if
 * the previous {@link run} stopped on one) so the next call can resolve it
 * with a tool response instead of a fresh user message.
 */
export type Session = {
  messages: ChatCompletionMessageParam[]
  pendingAskUserId?: string
}

/**
 * Creates an empty {@link Session} to pass to {@link run}.
 */
export function createSession(): Session {
  return { messages: [] }
}

/**
 * Runs an {@link Agent} on a prompt to completion, looping through
 * tool calls until the model asks the user a question (via the
 * {@link ASK_USER_TOOL} tool) or returns a final message.
 *
 * Yields an {@link AgentEvent} for each round's reasoning (if the model
 * returns `reasoning_content`), each tool call, an `ask_user` event when the
 * model wants a human reply, and the final message. Callers are responsible
 * for any logging/presentation.
 *
 * @param agent - The agent to run.
 * @param prompt - The human's message: either a fresh instruction, or the
 * answer to a pending `ask_user` question from the previous call.
 * @param session - Conversation state to continue; mutated in place so
 * callers can pass the same session back in on the next turn.
 */
export async function* run(
  agent: Agent,
  prompt: string,
  session: Session
): AsyncGenerator<AgentEvent, void, void> {
  const toolsByName = new Map(
    // @ts-ignore
    agent.tools.map((t) => [t.definition.function.name, t])
  )
  const definitions = agent.tools.map((t) => t.definition)
  const messages = session.messages

  if (messages.length === 0) {
    const system = [
      agent.instructions,
      toolsByName.has(ASK_USER_TOOL) ? ASK_USER_INSTRUCTIONS : undefined
    ]
      .filter(Boolean)
      .join("\n\n")
    if (system) messages.push({ role: "system", content: system })
  }

  if (session.pendingAskUserId) {
    messages.push({
      role: "tool",
      tool_call_id: session.pendingAskUserId,
      content: prompt
    })
    session.pendingAskUserId = undefined
  } else {
    messages.push({ role: "user", content: prompt })
  }

  while (true) {
    const stream = client.chat.completions.stream({
      model: agent.model,
      messages,
      tools: definitions
    })

    let thinking = ""
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta as
        | { reasoning_content?: string; content?: string }
        | undefined
      if (delta?.reasoning_content) {
        thinking += delta.reasoning_content
        yield {
          type: "delta",
          channel: "reasoning",
          text: delta.reasoning_content
        }
      }
      if (delta?.content)
        yield { type: "delta", channel: "content", text: delta.content }
    }

    const completion = await stream.finalChatCompletion()
    const raw = completion.choices[0]!.message
    // Don't push the stream helper's reconstructed message into the history
    // as-is: it carries extra fields (`parsed`, `refusal: null`) that
    // Fireworks rejects on the next request, and its `reasoning_content`
    // holds only the last delta fragment instead of the full text. Rebuild a
    // clean message so the history matches what the non-streaming API
    // returned before.
    const message = {
      role: "assistant" as const,
      content: raw.content,
      ...(raw.tool_calls?.length ? { tool_calls: raw.tool_calls } : {}),
      ...(thinking ? { reasoning_content: thinking } : {})
    }
    messages.push(message)

    if (thinking)
      yield {
        type: "reasoning",
        text: thinking
      }

    // Finished? Despite the system instructions the model occasionally still
    // ends with a plain-text question ("Want to play another round?"), so as
    // a backstop treat a final ending in "?" as ask_user — the next run()
    // call threads the reply as a regular user message.
    if (!message.tool_calls?.length) {
      const content =
        typeof message.content === "string" ? message.content : null
      if (content?.trimEnd().endsWith("?")) {
        yield { type: "ask_user", question: content }
        return
      }
      yield {
        type: "final",
        content: message.content
      }
      return
    }

    // Otherwise execute tool calls. ask_user is handled last so every other
    // tool_call_id in this message still gets a matching tool response
    // pushed before we stop for the human's reply (its own tool response is
    // pushed on the next run() call, once the human has answered).
    let ask: { id: string; question: string } | undefined
    for (const call of message.tool_calls) {
      if (call.type !== "function") continue

      if (call.function.name === ASK_USER_TOOL) {
        ask = {
          id: call.id,
          question: JSON.parse(call.function.arguments).question
        }
        continue
      }

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

    if (ask) {
      session.pendingAskUserId = ask.id
      yield { type: "ask_user", question: ask.question }
      return
    }
  }
}
