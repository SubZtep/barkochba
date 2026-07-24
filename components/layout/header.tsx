import { Box, Text } from "ink"
import Gradient from "ink-gradient"
import { describeToolCall } from "../../lib/tool-labels"
import { Spinner } from "../elem/spinner"
import { MonsterMate } from "../monster"

/**
 * Live top bar: current persona, and the right-hand slot which shows
 * in-flight tool activity, falling back to the active model name while idle.
 */
export function Header({
  persona,
  model,
  currentTool
}: {
  persona: string
  model: string
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
      ) : (
        <Box flexShrink={0}>
          <Text color="grey" dimColor wrap="truncate-end">
            {model}
          </Text>
        </Box>
      )}
    </Box>
  )
}
