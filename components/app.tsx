import { Text } from "ink"

type Props = {
  name: string | undefined
}

export default function App({ name = "Stranger" }: Props) {
  return (
    <Text>
      Hello, <Text color="green">{name}</Text>
    </Text>
import { Box, Text } from "ink"
import Gradient from "ink-gradient"
import TextInput from "ink-text-input"
import { useState } from "react"
import { useAgent } from "../hooks/use-agent"
import { useSound } from "../hooks/use-sound"
import { askUserTool } from "../lib/agents"
import { currentTimeTool } from "../tools/current-time"
import { readFileTool } from "../tools/read-file"
import { webSearchTool } from "../tools/web-search"

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

  return (
    <Box flexDirection="column">
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

      {/** biome-ignore lint/suspicious/useIterableCallbackReturn: return in switch cases */}
      {events.map((event, i) => {
        switch (event.type) {
          case "user":
            return (
              <Text key={i} dimColor>
                {"🗨️ > "}
                {event.text}
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
                <Text color="magenta">{event.text}</Text>
              </Box>
            )
          case "tool_call":
            return (
              <Text key={i} color="yellow">
                {"> "}
                {event.name}({event.arguments})
              </Text>
            )
          case "ask_user":
            return (
              <Text key={i} color="cyan">
                ? {event.question}
              </Text>
            )
          case "final":
            return <Text key={i}>{event.content}</Text>
        }
      })}

      {partial && partial.reasoning !== "" && (
        <Box borderStyle="singleDouble" borderDimColor paddingX={1}>
          <Text color="magenta">{partial.reasoning}</Text>
        </Box>
      )}
      {partial && partial.content !== "" && <Text>{partial.content}</Text>}

      <Box backgroundColor="#202040">
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
