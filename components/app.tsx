import { Box, Static, Text, useStdout } from "ink"
import Gradient from "ink-gradient"
import { useState } from "react"
import { type TimelineEvent, useAgent } from "../hooks/use-agent"
import { useSound } from "../hooks/use-sound"
import { askUserTool } from "../lib/agents"
import { currentTimeTool } from "../tools/current-time"
import { myLocationTool } from "../tools/my-location"
import { readFileTool } from "../tools/read-file"
import { webSearchTool } from "../tools/web-search"
import Markdown from "./markdown"
import { UserInput } from "./user-input"

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
    tools: [
      readFileTool,
      currentTimeTool,
      askUserTool,
      webSearchTool,
      myLocationTool
    ]
  })
  const [thinking, setThinking] = useState(true)
  const [sounds, setSounds] = useState(true)
  const [timelineEpoch, setTimelineEpoch] = useState(0)
  const { write } = useStdout()
  useSound(events, sounds)

  // Slash menu (opened by typing "/" in the input). Indexes match onMenuSelect.
  const menuItems = [
    `Toggle thinking [${thinking ? "on" : "off"}]`,
    `Toggle sounds [${sounds ? "on" : "off"}]`,
    "Change model"
  ]
  const onMenuSelect = (index: number) => {
    if (index === 0) {
      setThinking((prev) => !prev)
      // <Static> output is printed to the terminal permanently, so hiding or
      // re-showing already-printed reasoning means wiping the screen (incl.
      // scrollback) and remounting <Static> via its key so it reprints the
      // whole timeline under the new setting.
      write("\x1b[2J\x1b[3J\x1b[H")
      setTimelineEpoch((prev) => prev + 1)
    }
    if (index === 1) setSounds((prev) => !prev)
    // index 2: model switching isn't wired up yet — the model comes from the
    // config at startup and the agent is constructed once.
  }

  const timeline: StaticItem[] = [{ type: "header" }, ...events]

  return (
    <Box flexDirection="column">
      <Static key={timelineEpoch} items={timeline}>
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
                    <Text color="green">
                      Hello, <Text color="greenBright">{name}</Text>
                    </Text>
                  </Box>
                </Box>
              )
            case "user":
              return (
                <Text key={i} color="cyanBright">
                  {`> ${item.text}`}
                </Text>
              )
            case "reasoning":
              if (!thinking) return null
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
                  {`> ${item.name}(${item.arguments})`}
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

      {thinking && partial && partial.reasoning !== "" && (
        <Box borderStyle="singleDouble" borderDimColor paddingX={1}>
          <Text color="magenta">
            <Markdown>{partial.reasoning}</Markdown>
          </Text>
        </Box>
      )}
      {partial && partial.content !== "" && <Text>{partial.content}</Text>}

      <UserInput
        pending={pending}
        send={send}
        menuItems={menuItems}
        onMenuSelect={onMenuSelect}
      />
    </Box>
  )
}
