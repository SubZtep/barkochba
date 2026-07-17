import { Box, Text } from "ink"
import Gradient from "ink-gradient"

/** One-time banner printed at the top of the timeline. */
export function Header({ model }: { model: string }) {
  return (
    <Box gap={1}>
      <Text color="#ff1493" bold>
        ༼☉ɷ⊙༽
      </Text>
      <Gradient name="rainbow">
        <Text>{model}</Text>
      </Gradient>
    </Box>
  )
}
