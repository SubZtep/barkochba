import { Box, Text } from "ink"
import Image from "ink-picture"
import { memo } from "react"
import type { TimelineEvent } from "../hooks/use-agent"
import type { ErrorCategory } from "../lib/error-category"
import { t } from "../lib/i18n"
import Markdown from "./elem/markdown"
import { ReasoningBox } from "./reasoning-box"

const ERROR_ICON: Record<ErrorCategory, string> = {
  network: "⚠",
  tool: "✗",
  agent: "✗",
  unknown: "✗"
}

/**
 * One finalized timeline entry (user message, tool call, final reply, …).
 * Memoized: events are immutable once appended, so scroll ticks and
 * streaming flushes (which re-render the whole ScrollView subtree) bail
 * out here instead of re-rendering every history item.
 */
export const TimelineItem = memo(function TimelineItem({
  item,
  thinking
}: {
  item: TimelineEvent
  thinking: boolean
}) {
  const content = renderItem(item, thinking)
  if (content === null) return null
  return (
    <Box flexDirection="column">
      <Text> </Text>
      {content}
    </Box>
  )
})

function renderItem(item: TimelineEvent, thinking: boolean) {
  switch (item.type) {
    case "user":
      return <Text color="cyanBright">{`> ${item.text}`}</Text>
    case "reasoning":
      if (!thinking) return null
      return <ReasoningBox>{item.text}</ReasoningBox>
    case "tool_image":
      return <Text dimColor>{`[image: ${item.path}]`}</Text>
    case "display_image":
      return (
        <Box flexDirection="column">
          <Image src={item.url} width={10} height={5} alt={item.alt} />
          <Text dimColor>{item.alt}</Text>
        </Box>
      )
    case "message":
      return (
        <Box gap={2}>
          <Text color="#ff1493">●</Text>
          <Markdown>{item.content}</Markdown>
        </Box>
      )
    case "ask_user":
      return (
        <Box gap={2}>
          <Text color="cyanBright">●</Text>
          <Markdown>{item.question}</Markdown>
        </Box>
      )
    case "confirm_command":
      return <Text color="yellow">{`$ ${item.command}`}</Text>
    case "error":
      return (
        <Text color="red">
          {`${ERROR_ICON[item.category]} ${t(`error.${item.category}`)}: ${item.text}`}
        </Text>
      )
    case "final":
      return <Markdown>{item.content ?? "N/A"}</Markdown>
  }
}
