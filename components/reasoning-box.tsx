import { Box, Text } from "ink"
import Markdown from "./elem/markdown"

/** The dim-bordered magenta box the model's reasoning is rendered in. */
export function ReasoningBox({ children }: { children: string }) {
  return (
    <Box borderStyle="singleDouble" borderDimColor paddingX={1}>
      <Text color="magenta">
        <Markdown>{children}</Markdown>
      </Text>
    </Box>
  )
}
