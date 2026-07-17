import { Box, Text } from "ink"
import Gradient from "ink-gradient"
import Link from "../elem/link"
import { MonsterMate } from "../monster"

/** Live top bar: model name and optional geo pin. */
export function Header({
  model,
  location
}: {
  model: string
  location?: string
}) {
  return (
    <Box flexShrink={0} justifyContent="space-between" paddingX={1}>
      <Box gap={1}>
        <MonsterMate />
        <Box overflow="hidden">
          <Gradient name="rainbow">
            <Text wrap="truncate-end">{model}</Text>
          </Gradient>
        </Box>
      </Box>
      <Box flexShrink={0}>
        <Link href="https://github.com/SubZtep/barkochba" color="grey" dimColor>
          GitHub
        </Link>
      </Box>
      <Box flexShrink={0} gap={1}>
        <Text color="red">@</Text>
        <Text dimColor>{location ?? "N/A"}</Text>
      </Box>
    </Box>
  )
}
