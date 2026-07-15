import { Box, Static, Text } from "ink"
import Gradient from "ink-gradient"
import TextInput from "ink-text-input"
import { useState } from "react"
import { type TimelineEvent, useAgent } from "../hooks/use-agent"
import { useSound } from "../hooks/use-sound"
import { askUserTool } from "../lib/agents"
import { currentTimeTool } from "../tools/current-time"
import { readFileTool } from "../tools/read-file"
import { webSearchTool } from "../tools/web-search"
import Markdown from "./markdown"

/**
 * Items rendered through Ink's `<Static>`: the one-time header, then the
 * finalized timeline. Static writes each item to the terminal exactly once
 * and never re-renders it, so streaming deltas only repaint the small
 * dynamic region below (partial message + input).
 */
type StaticItem = { type: "header" } | TimelineEvent

export default function App({
  name = "Stranger"
}: {
  name: string | undefined
}) {
  const { agent, events, partial, pending, send } = useAgent({
    model: process.env.OPENAI_API_MODEL!,
    tools: [readFileTool, currentTimeTool, askUserTool, webSearchTool]
  })
  useSound(events)

  const [input, setInput] = useState("")

  const handleSubmit = (value: string) => {
    if (!value.trim() || pending) return
    setInput("")
    send(value)
  }

  const timeline: StaticItem[] = [{ type: "header" }, ...events]

  return (
    <Box flexDirection="column">
      <Static items={timeline}>
        {(item, i) => {
          switch (item.type) {
            case "header":
              return (
                <Box key="header" flexDirection="column">
                  <Box gap={1}>
                    <Text color="#ff1493" bold>
                      ༼☉ɷ⊙༽
                    </Text>
                    <Gradient name="rainbow">
                      <Text>{agent.model}</Text>
                    </Gradient>
                  </Box>
                  <Box marginLeft={6}>
                    <Text>
                      Hello, <Text color="green">{name}</Text>
                    </Text>
                  </Box>
                </Box>
              )
            case "user":
              return (
                <Text key={i} dimColor>
                  {"🗨️ > "}
                  {item.text}
                </Text>
              )
            case "reasoning":
              return (
                <Box
                  key={i}
                  borderStyle="singleDouble"
                  borderDimColor
                  paddingX={1}
                >
                  <Text color="magenta">
                    <Markdown>{item.text}</Markdown>
                  </Text>
                </Box>
              )
            case "tool_call":
              return (
                <Text key={i} color="yellow">
                  {"> "}
                  {item.name}({item.arguments})
                </Text>
              )
            case "ask_user":
              return (
                <Text color="cyan" key={i}>
                  <Markdown>{item.question}</Markdown>
                </Text>
              )
            case "final":
              return <Markdown key={i}>{item.content ?? "?"}</Markdown>
          }
        }}
      </Static>

      {partial && partial.reasoning !== "" && (
        <Box borderStyle="singleDouble" borderDimColor paddingX={1}>
          <Text color="magenta">
            <Markdown>{partial.reasoning}</Markdown>
          </Text>
        </Box>
      )}
      {partial && partial.content !== "" && <Text>{partial.content}</Text>}

      <Box backgroundColor="#202040" padding={1}>
        <Text>{"🗨️ > "}</Text>
        <Text color="whiteBright">
          <TextInput
            value={input}
            focus={!pending}
            onChange={setInput}
            onSubmit={handleSubmit}
            showCursor={true}
          />
        </Text>
      </Box>
    </Box>
  )
}
