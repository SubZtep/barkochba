import { Marked, type Token, type Tokens } from "marked"

/**
 * Renders assistant Markdown as Telegram `parse_mode: "HTML"` text. A
 * hand-rolled token-tree walk (not marked.use(renderer)) using a fresh
 * `Marked` instance, so it never shares mutable renderer state with
 * components/elem/markdown.tsx's marked-terminal instance — that instance
 * installs ANSI-producing renderers globally via marked.use() on the shared
 * singleton, and Telegram needs an entirely different output, not another
 * marked.use() extension layered on top of it.
 */
const telegramMarked = new Marked()

/** Telegram's HTML parse mode only requires escaping these three characters. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** Same three, plus the quote that would otherwise close an attribute early. */
function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;")
}

function renderInlineTokens(tokens: Token[] | undefined): string {
  if (!tokens) return ""
  return tokens.map(renderInlineToken).join("")
}

function renderInlineToken(token: Token): string {
  switch (token.type) {
    case "strong":
      return `<b>${renderInlineTokens((token as Tokens.Strong).tokens)}</b>`
    case "em":
      return `<i>${renderInlineTokens((token as Tokens.Em).tokens)}</i>`
    case "del":
      return `<s>${renderInlineTokens((token as Tokens.Del).tokens)}</s>`
    case "codespan":
      return `<code>${escapeHtml((token as Tokens.Codespan).text)}</code>`
    case "link": {
      const link = token as Tokens.Link
      return `<a href="${escapeAttr(link.href)}">${renderInlineTokens(link.tokens)}</a>`
    }
    case "image": {
      const image = token as Tokens.Image
      return `<a href="${escapeAttr(image.href)}">${escapeHtml(image.text || image.href)}</a>`
    }
    case "br":
      return "\n"
    case "escape":
      return escapeHtml((token as Tokens.Escape).text)
    case "text": {
      const text = token as Tokens.Text
      // Some inline text tokens (e.g. inside a single-line list item) carry
      // their own nested tokens instead of plain .text — recurse into those
      // when present, same fix components/elem/markdown.tsx applies for
      // marked-terminal's renderer.
      return text.tokens
        ? renderInlineTokens(text.tokens)
        : escapeHtml(text.text)
    }
    default:
      return escapeHtml("text" in token ? (token.text as string) : token.raw)
  }
}

const BULLET = "• "

function listItemPrefix(item: Tokens.ListItem, ordered: boolean, n: number) {
  if (item.task) return item.checked ? "☑ " : "☐ "
  return ordered ? `${n}. ` : BULLET
}

function renderListItem(
  item: Tokens.ListItem,
  ordered: boolean,
  n: number
): string {
  const prefix = listItemPrefix(item, ordered, n)
  const lines: string[] = []
  let inline = ""
  for (const t of item.tokens) {
    if (t.type === "list") {
      if (inline) {
        lines.push(prefix + inline)
        inline = ""
      }
      const nested = renderList(t as Tokens.List)
      lines.push(
        nested
          .split("\n")
          .map((l) => `  ${l}`)
          .join("\n")
      )
    } else if (t.type === "text" || t.type === "paragraph") {
      const withTokens = t as Tokens.Text | Tokens.Paragraph
      inline += withTokens.tokens
        ? renderInlineTokens(withTokens.tokens)
        : escapeHtml(withTokens.text)
    } else {
      inline += renderInlineToken(t)
    }
  }
  if (inline || lines.length === 0) lines.unshift(prefix + inline)
  return lines.join("\n")
}

function renderList(token: Tokens.List): string {
  return token.items
    .map((item, i) =>
      renderListItem(
        item,
        token.ordered,
        (token.ordered && token.start !== "" ? token.start : 1) + i
      )
    )
    .join("\n")
}

function renderCode(token: Tokens.Code): string {
  const cls = token.lang
    ? ` class="language-${escapeAttr(token.lang.split(/\s/)[0]!)}"`
    : ""
  return `<pre><code${cls}>${escapeHtml(token.text)}</code></pre>`
}

function renderTable(token: Tokens.Table): string {
  const row = (cells: { text: string }[]) =>
    cells.map((c) => c.text).join(" | ")
  const lines = [row(token.header), ...token.rows.map(row)]
  return `<pre>${escapeHtml(lines.join("\n"))}</pre>`
}

function renderBlockToken(token: Token): string {
  switch (token.type) {
    case "heading":
      return `<b>${renderInlineTokens((token as Tokens.Heading).tokens)}</b>`
    case "paragraph":
      return renderInlineTokens((token as Tokens.Paragraph).tokens)
    case "list":
      return renderList(token as Tokens.List)
    case "blockquote":
      return `<blockquote>${(token as Tokens.Blockquote).tokens.map(renderBlockToken).join("\n")}</blockquote>`
    case "code":
      return renderCode(token as Tokens.Code)
    case "table":
      return renderTable(token as Tokens.Table)
    case "hr":
      return "———"
    case "space":
    case "def":
      return ""
    default:
      return escapeHtml("text" in token ? (token.text as string) : token.raw)
  }
}

/** Telegram's hard per-message character cap for both text and captions. */
export const TELEGRAM_MESSAGE_LIMIT = 4096

export function renderTelegramHtml(markdown: string): string {
  const tokens = telegramMarked.lexer(markdown)
  return tokens
    .map(renderBlockToken)
    .filter((block) => block.length > 0)
    .join("\n\n")
    .trim()
}

/**
 * Splits already-rendered Telegram HTML into <=`limit`-char chunks for
 * separate sendMessage calls, breaking on a blank-line boundary where
 * possible so it doesn't sever a tag pair mid-block. Used only at
 * final/flush time — editMessageText always targets one existing message,
 * so it can't be split this way.
 */
export function splitTelegramMessage(
  html: string,
  limit = TELEGRAM_MESSAGE_LIMIT
): string[] {
  if (html.length <= limit) return [html]
  const chunks: string[] = []
  let remaining = html
  while (remaining.length > limit) {
    let splitAt = remaining.lastIndexOf("\n\n", limit)
    if (splitAt <= 0) splitAt = limit
    chunks.push(remaining.slice(0, splitAt).trim())
    remaining = remaining.slice(splitAt).trim()
  }
  if (remaining) chunks.push(remaining)
  return chunks
}

/**
 * Cheap, not tag-safe truncation for in-flight streaming edits that exceed
 * the message limit — good enough since it's only ever transient (the next
 * edit tick replaces it, and the final flush uses splitTelegramMessage for
 * the real, tag-safe multi-message split).
 */
export function truncateForStreaming(
  html: string,
  limit = TELEGRAM_MESSAGE_LIMIT
): string {
  if (html.length <= limit) return html
  const ellipsis = "\n…"
  return html.slice(0, Math.max(0, limit - ellipsis.length)) + ellipsis
}
