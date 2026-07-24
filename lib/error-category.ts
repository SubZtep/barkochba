import { APIError } from "openai"
import { ToolError } from "./agents"

export type ErrorCategory = "network" | "tool" | "agent" | "unknown"

/**
 * Classifies an error caught from a failed {@link run} so the timeline can
 * show a differentiated message instead of one generic red line for every
 * kind of failure. Network errors caught here always come from the chat
 * completion request, so they're prefixed with "LLM API" — the model/
 * provider name itself isn't meaningful to the user, just that it's the
 * chat call (as opposed to a tool's own network call, which surfaces as a
 * ToolError instead, already labeled by tool name).
 */
export function categorizeError(error: unknown): {
  category: ErrorCategory
  message: string
} {
  if (error instanceof APIError) {
    return { category: "network", message: `LLM API: ${error.message}` }
  }
  if (error instanceof ToolError) {
    return { category: "tool", message: `${error.toolName}: ${error.message}` }
  }
  if (error instanceof Error) {
    return { category: "agent", message: error.message }
  }
  return { category: "unknown", message: String(error) }
}
