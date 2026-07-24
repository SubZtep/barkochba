import { Box, Text } from "ink"
import Gradient from "ink-gradient"
import { describeToolCall } from "../../lib/tool-labels"
import { Spinner } from "../elem/spinner"
import { MonsterMate } from "../monster"

/** Live top bar: current persona, and in-flight tool activity. */
export function Header({
  persona,
  currentTool
}: {
  persona: string
  currentTool?: { name: string; arguments: string }
}) {
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
            <Spinner type="boxBounce" />
            {` ${describeToolCall(currentTool.name, currentTool.arguments)}`}
          </Text>
        </Box>
      ) : null}
    </Box>
  )
}
