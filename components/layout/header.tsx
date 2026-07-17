import { Box, Text } from "ink"
import Gradient from "ink-gradient"

/** Live top bar: model name and optional geo pin. */
export function Header({
  model,
  location
}: {
  model: string
  location?: string
}) {
  return (
    <Box flexDirection="column" flexShrink={0} width="100%" marginBottom={1}>
      <Box gap={1} width="100%">
        <Text color="#ff1493" bold>
          ༼☉ɷ⊙༽
        </Text>
        <Box flexGrow={1} flexShrink={1} overflow="hidden">
          <Gradient name="rainbow">
            <Text wrap="truncate-end">{model}</Text>
          </Gradient>
        </Box>
      </Box>
      {location ? (
        <Text dimColor wrap="truncate-end">{`📍 ${location}`}</Text>
      ) : null}
    </Box>
  )
}
