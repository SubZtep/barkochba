import { Text } from "ink"
import type { TimelineEvent } from "../hooks/use-agent"
import Markdown from "./elem/markdown"
import { ReasoningBox } from "./reasoning-box"

/** One finalized timeline entry (user message, tool call, final reply, …). */
export function TimelineItem({
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
      return <Text color="yellow">{`> ${item.name}(${item.arguments})`}</Text>
    case "message":
      return <Markdown>{item.content}</Markdown>
    case "ask_user":
      return (
        <Text color="cyan">
          <Markdown>{item.question}</Markdown>
        </Text>
      )
    case "error":
      return <Text color="red">{`✗ ${item.text}`}</Text>
    case "final":
      return <Markdown>{item.content ?? "?"}</Markdown>
  }
}
