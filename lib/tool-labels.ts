import { t } from "./i18n"

/**
 * Human-readable one-liner for a tool call, shown in the timeline instead
 * of the raw `{name}({arguments})` JSON. Only the built-in tools (defined
 * in tools/*.ts and lib/agents.ts) have a label; MCP tools (Playwright,
 * Chrome DevTools — dynamic, unknown at build time) and any future tool
 * without an entry here fall back to the raw display.
 */
const LABELS: Record<string, (args: any) => string> = {
  web_search: (args) => t("toolCall.webSearch", { query: args.query }),
  fetch_url: (args) => t("toolCall.fetchUrl", { url: args.url }),
  current_time: (args) =>
    t("toolCall.currentTime", {
      timezone: args.timezone ? ` (${args.timezone})` : ""
    }),
  generate_image: (args) =>
    t("toolCall.generateImage", { prompt: args.prompt }),
  list_files: (args) => t("toolCall.listFiles", { path: args.path }),
  read_file: (args) => t("toolCall.readFile", { path: args.path }),
  view_image: (args) => t("toolCall.viewImage", { path: args.path }),
  remember_note: (args) => t("toolCall.rememberNote", { key: args.key }),
  recall_memory: (args) =>
    t("toolCall.recallMemory", {
      query: args.query ? ` "${args.query}"` : ""
    }),
  forget_note: () => t("toolCall.forgetNote"),
  list_notes: () => t("toolCall.listNotes"),
  rerank: (args) => t("toolCall.rerank", { n: args.documents?.length ?? 0 }),
  summarize: () => t("toolCall.summarize")
}

/**
 * Describes a tool call in plain language for the timeline. Falls back to
 * the raw `{name}({arguments})` form when the tool has no label or the
 * arguments fail to parse (e.g. a malformed call from the model).
 */
export function describeToolCall(name: string, argumentsJson: string): string {
  const label = LABELS[name]
  if (!label) return `${name}(${argumentsJson})`
  try {
    return label(JSON.parse(argumentsJson))
  } catch {
    return `${name}(${argumentsJson})`
  }
}
