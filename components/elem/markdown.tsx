import dedent from "dedent"
import { Text } from "ink"
import { type MarkedExtension, marked } from "marked"
import { markedTerminal } from "marked-terminal"
import { memo } from "react"

// @types/marked-terminal lags the v7 runtime API, which returns a MarkedExtension
marked.use(markedTerminal() as unknown as MarkedExtension)

/**
 * Module-level parse cache: parsing is by far the most expensive per-item
 * work, and the same string is parsed again whenever a history item
 * remounts (scrolling brings it back into the virtualized window). Keyed
 * on the source string only — marked-terminal wraps at its own fixed
 * width, so output doesn't depend on the terminal size. Cleared wholesale
 * past a cap to bound memory (streaming partials insert throwaway
 * prefixes).
 */
const parsed = new Map<string, string>()

function parseMarkdown(source: string) {
  const hit = parsed.get(source)
  if (hit !== undefined) return hit
  const out = dedent(marked.parse(source) as string)
  if (parsed.size > 500) parsed.clear()
  parsed.set(source, out)
  return out
}

// memo() so scroll ticks (which re-render mounted subtrees) skip items
// whose text is unchanged entirely.
export default memo(function Markdown({ children }: { children: string }) {
  return <Text>{parseMarkdown(children)}</Text>
})
