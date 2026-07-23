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
  switch (item.type) {
    case "user":
      return <Text color="cyanBright">{`> ${item.text}`}</Text>
    case "reasoning":
      if (!thinking) return null
      return <ReasoningBox>{item.text}</ReasoningBox>
    case "tool_call":
      return null
    case "tool_image":
      return <Text dimColor>{`[image: ${item.path}]`}</Text>
    case "display_image":
      return (
        <Box gap={1}>
          <Text dimColor>{item.alt}</Text>
          <Image src={item.url} width={20} height={10} alt={item.alt} />
        </Box>
      )
    case "message":
      return (
        <Box gap={1}>
          <Text color="#ff1493">●</Text>
          <Markdown>{item.content}</Markdown>
        </Box>
      )
    case "ask_user":
      return (
        <Text color="cyan">
          <Markdown>{item.question}</Markdown>
        </Text>
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
      return (
        <Box gap={1}>
          <Text color="#ff1493">●</Text>
          <Markdown>{item.content ?? "?"}</Markdown>
        </Box>
      )
  }
})
