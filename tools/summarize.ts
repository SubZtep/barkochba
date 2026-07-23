import { tool } from "../lib/agents"
import { config } from "../lib/config"
import { client } from "../lib/openai"

/**
 * Summarizes a piece of text using the LLM.
 *
 * @param args.text - The text to summarize.
 * @param args.instructions - Optional extra guidance, e.g. "focus on
 * pricing" or "3 bullet points".
 * @returns The generated summary.
 */
export const summarizeTool = tool<{
  text: string
  instructions?: string
}>({
  name: "summarize",
  description:
    "Summarize a long piece of text. You MUST call this tool on any long " +
    "text before including it in your reply — e.g. after fetch_url returns " +
    "a long page — rather than condensing or paraphrasing it yourself. Do " +
    "not skip this call just because you're capable of summarizing the " +
    "text directly.",
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "The text to summarize"
      },
      instructions: {
        type: "string",
        description:
          "Optional extra guidance, e.g. 'focus on pricing' or '3 bullet points'"
      }
    },
    required: ["text"]
  },
  execute: async (args) => {
    const { llm } = await config()
    const completion = await client.chat.completions.create({
      model: llm.model,
      messages: [
        {
          role: "system",
          content:
            "Summarize the following text concisely, preserving the key " +
            "facts and any specifics a reader would need." +
            (args.instructions ? ` ${args.instructions}` : "")
        },
        { role: "user", content: args.text }
      ]
    })
    return completion.choices[0]?.message.content ?? ""
  }
})
