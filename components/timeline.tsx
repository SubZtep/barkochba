import { Static, Text } from "ink"
import type { TimelineEvent } from "../hooks/use-agent"
import { Header } from "./header"
import Markdown from "./markdown"
import { ReasoningBox } from "./reasoning-box"

/**
 * Items rendered through Ink's `<Static>`: the one-time header, then the
 * finalized timeline. Static writes each item to the terminal exactly once
 * and never re-renders it, so streaming deltas only repaint the small
 * dynamic region below (partial message + input).
 */
type StaticItem = { type: "header" } | TimelineEvent

/**
 * The finalized chat history. Changing `epoch` remounts the inner <Static>,
 * making it reprint every item from scratch — the caller pairs that with a
 * terminal wipe (see useSettings) so toggling `thinking` applies to
 * already-printed reasoning too.
 */
export function Timeline({
  events,
  epoch,
  thinking,
  model,
  name
}: {
  events: TimelineEvent[]
  epoch: number
  thinking: boolean
  model: string
  name: string
}) {
  const items: StaticItem[] = [{ type: "header" }, ...events]

  return (
    <Static key={epoch} items={items}>
      {(item, i) => {
        switch (item.type) {
          case "header":
            return <Header key="header" model={model} name={name} />
          case "user":
            return (
              <Text key={i} color="cyanBright">
                {`> ${item.text}`}
              </Text>
            )
          case "reasoning":
            if (!thinking) return null
            return <ReasoningBox key={i}>{item.text}</ReasoningBox>
          case "tool_call":
            return (
              <Text key={i} color="yellow">
                {`> ${item.name}(${item.arguments})`}
              </Text>
            )
          case "message":
            return <Markdown key={i}>{item.content}</Markdown>
          case "ask_user":
            return (
              <Text color="cyan" key={i}>
                <Markdown>{item.question}</Markdown>
              </Text>
            )
          case "error":
            return (
              <Text key={i} color="red">
                {`✗ ${item.text}`}
              </Text>
            )
          case "final":
            return <Markdown key={i}>{item.content ?? "?"}</Markdown>
        }
      }}
    </Static>
  )
}
