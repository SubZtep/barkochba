import { homedir } from "node:os"
import OpenAI from "openai"
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool
} from "openai/resources/chat/completions"
import type { ResolvedModel } from "../schemas/models"
import { getLanguage } from "./i18n"
import { loadMemory } from "./memory-store"
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
  client: OpenAI
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
    this.client = client
    this.tools = config.tools
    this.instructions = config.instructions
  }

  /** Point the agent at another model, swapping the client to its provider. */
  setModel(model: ResolvedModel) {
    this.model = model.id
    this.client = new OpenAI({
      baseURL: model.baseUrl,
      // Local providers ignore the key, but the SDK insists on having one.
      apiKey: model.apiKey ?? "unused"
    })
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

/** Appended when the app runs in Hungarian (settings.language). */
const HUNGARIAN_REPLY_INSTRUCTIONS =
  "The user speaks Hungarian. Always reply in Hungarian, including " +
  "questions asked through the ask_user tool."

/** Grounds the model in the host OS and home directory so path-related tools (list_files, read_file) get correct conventions instead of guessing (e.g. assuming /root). */
const PLATFORM_INSTRUCTIONS = `You are running on ${process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux"}. Use ${process.platform === "win32" ? "backslash" : "forward-slash"} paths accordingly. The user's home directory is ${homedir()}.`

/**
 * Name of the built-in tool the model calls to propose a shell command. Like
 * {@link ASK_USER_TOOL}, {@link run} intercepts calls to this tool by name
 * instead of executing it: it ends the generator so the caller can show the
 * human the proposed command, get their approval, run it (or not), and
 * continue the conversation with the result.
 */
export const RUN_COMMAND_TOOL = "run_command"

/**
 * System-prompt guidance injected by {@link run} when an agent has the
 * {@link runCommandTool}.
 */
const RUN_COMMAND_INSTRUCTIONS =
  `Use ${RUN_COMMAND_TOOL} to run a shell command on the user's computer — ` +
  `e.g. playing a sound, converting a file, checking installed tools. The ` +
  `human will be shown the exact command and must approve it before it ` +
  `runs; if they decline, treat it as not done and tell them so, don't ` +
  `retry the same command silently. Prefer read-only tools for anything ` +
  `that only needs to inspect something — reserve this for when you ` +
  `actually need to change state or invoke an external program.`

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
 * Tool the model calls to propose a shell command, pausing until the human
 * approves or declines it. Never actually executed — {@link run} intercepts
 * calls to it by name before dispatch; the caller runs the command (or not)
 * and feeds the result back as the next `run()` call's prompt.
 */
export const runCommandTool = tool<{ command: string; description: string }>({
  name: RUN_COMMAND_TOOL,
  description:
    "Propose a shell command to run on the user's computer. Requires " +
    "human approval before it executes. Use for actions like playing a " +
    "sound, converting media, or invoking a CLI tool.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "The shell command to run" },
      description: {
        type: "string",
        description:
          "One short sentence explaining what this command does, shown to the human alongside it"
      }
    },
    required: ["command", "description"]
  },
  execute: async () => {
    throw new Error(
      `${RUN_COMMAND_TOOL} should be intercepted by run(), not executed`
    )
  }
})

/**
 * Name of the tool that gates the persistent-memory feature: when an agent
 * has it, {@link run} injects {@link MEMORY_INSTRUCTIONS} and the sticky
 * notes into the session's system prompt. Unlike {@link ASK_USER_TOOL} and
 * {@link RUN_COMMAND_TOOL} it is not intercepted — the memory tools
 * execute normally.
 */
export const REMEMBER_NOTE_TOOL = "remember_note"

/**
 * System-prompt guidance injected by {@link run} when an agent has the
 * memory tools. Gives each tool a purpose (not just a name) and tells the
 * model to write proactively rather than waiting to be asked.
 */
const MEMORY_INSTRUCTIONS =
  "You have persistent memory across sessions. Save durable facts about " +
  `the user or project with ${REMEMBER_NOTE_TOOL} the moment you learn ` +
  "them — don't ask permission first. Search past facts with " +
  "recall_memory whenever earlier context could help with the current " +
  "question. Audit what's stored with list_notes, and delete stale or " +
  "wrong notes with forget_note — keep the store curated. Notes marked " +
  "sticky are shown to you automatically at the start of every future " +
  "session; use sticky for things that should always be known (who the " +
  "user is, their preferences), and non-sticky for things only worth " +
  "recalling on a relevant query. Name keys with a scope prefix — " +
  "user:, project:, decision: — like user:communication-style, so keys " +
  "stay consistent and don't collide."

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
  | { type: "message"; content: string }
  | { type: "tool_call"; name: string; arguments: string }
  | { type: "ask_user"; question: string }
  | { type: "confirm_command"; command: string; description: string }
  | { type: "final"; content: string | null }

/**
 * {@link AgentEvent} minus the ephemeral {@link AgentDelta} fragments — the
 * events that make up the permanent conversation timeline.
 */
export type FinalizedAgentEvent = Exclude<AgentEvent, AgentDelta>

/**
 * Conversation state threaded through repeated {@link run} calls: the
 * message history, and the id of a pending {@link ASK_USER_TOOL} or
 * {@link RUN_COMMAND_TOOL} call (if the previous {@link run} stopped on one)
 * so the next call can resolve it with a tool response instead of a fresh
 * user message.
 */
export type Session = {
  messages: ChatCompletionMessageParam[]
  pendingAskUserId?: string
  pendingRunCommandId?: string
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
 * returns `reasoning_content`), any plain content accompanying tool calls
 * (as a `message` event), each tool call, an `ask_user` event when the
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
    const hasMemory = toolsByName.has(REMEMBER_NOTE_TOOL)
    const stickyNotes = hasMemory
      ? Object.entries(await loadMemory()).filter(([, note]) => note.sticky)
      : []
    const stickyBlock =
      stickyNotes.length > 0
        ? `Known context about this user/project (from persistent memory):\n${stickyNotes
            .map(([key, note]) => `- [${key}] ${note.content}`)
            .join("\n")}`
        : undefined

    const system = [
      agent.instructions,
      PLATFORM_INSTRUCTIONS,
      toolsByName.has(ASK_USER_TOOL) ? ASK_USER_INSTRUCTIONS : undefined,
      toolsByName.has(RUN_COMMAND_TOOL) ? RUN_COMMAND_INSTRUCTIONS : undefined,
      hasMemory ? MEMORY_INSTRUCTIONS : undefined,
      stickyBlock,
      getLanguage() === "hu" ? HUNGARIAN_REPLY_INSTRUCTIONS : undefined
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
  } else if (session.pendingRunCommandId) {
    messages.push({
      role: "tool",
      tool_call_id: session.pendingRunCommandId,
      content: prompt
    })
    session.pendingRunCommandId = undefined
  } else {
    messages.push({ role: "user", content: prompt })
  }

  while (true) {
    const stream = agent.client.chat.completions.stream({
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

    // Some models answer in plain content and call ask_user in the same
    // message (e.g. "No, it's not a pet." + "your next question?"). That
    // content only surfaces through the `final` event, which tool-call
    // rounds never reach — so yield it here instead of dropping it.
    if (typeof message.content === "string" && message.content.trim())
      yield { type: "message", content: message.content }

    // Otherwise execute tool calls. ask_user/run_command are handled last so
    // every other tool_call_id in this message still gets a matching tool
    // response pushed before we stop for the human (their own tool response
    // is pushed on the next run() call, once the human has answered).
    let ask: { id: string; question: string } | undefined
    let confirm:
      | { id: string; command: string; description: string }
      | undefined
    for (const call of message.tool_calls) {
      if (call.type !== "function") continue

      if (call.function.name === ASK_USER_TOOL) {
        ask = {
          id: call.id,
          question: JSON.parse(call.function.arguments).question
        }
        continue
      }

      if (call.function.name === RUN_COMMAND_TOOL) {
        const args = JSON.parse(call.function.arguments)
        confirm = {
          id: call.id,
          command: args.command,
          description: args.description
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

    if (confirm) {
      session.pendingRunCommandId = confirm.id
      yield {
        type: "confirm_command",
        command: confirm.command,
        description: confirm.description
      }
      return
    }
  }
}
