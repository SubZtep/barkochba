import { Box, Text } from "ink"
import Gradient from "ink-gradient"
import { t } from "../../lib/i18n"
import { MonsterMate } from "../monster"

/** Live top bar: model name, current persona, and optional geo pin. */
export function Header({
  model,
  persona,
  location
}: {
  model: string
  persona: string
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
        <Text dimColor>{persona}</Text>
      </Box>
      <Box flexShrink={0} gap={1}>
        <Text color="red">@</Text>
        <Text dimColor>{location ?? t("header.na")}</Text>
      </Box>
    </Box>
  )
}
