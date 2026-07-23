import { Box, Text } from "ink"
import Gradient from "ink-gradient"
import { useEffect, useState } from "react"
import { describeToolCall } from "../../lib/tool-labels"
import { MonsterMate } from "../monster"

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const TICK_MS = 120

/** Live top bar: current persona, and in-flight tool activity. */
export function Header({
  persona,
  currentTool
}: {
  persona: string
  currentTool?: { name: string; arguments: string }
}) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!currentTool) return
    setTick(0)
    const timer = setInterval(() => setTick((t) => t + 1), TICK_MS)
    return () => clearInterval(timer)
  }, [currentTool])

  return (
    <Box flexShrink={0} justifyContent="space-between" paddingX={1}>
      <Box gap={1}>
        <MonsterMate />
        <Box overflow="hidden">
          <Gradient name="rainbow">
            <Text wrap="truncate-end">{persona}</Text>
          </Gradient>
        </Box>
      </Box>
      {currentTool ? (
        <Box flexShrink={0} gap={1}>
          <Text color="green" dimColor>
            {`${FRAMES[tick % FRAMES.length]} ${describeToolCall(currentTool.name, currentTool.arguments)}`}
          </Text>
        </Box>
      ) : null}
    </Box>
  )
}
