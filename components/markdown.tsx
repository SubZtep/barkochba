import { Text } from "ink"
import { type MarkedExtension, marked } from "marked"
import { markedTerminal } from "marked-terminal"

// @types/marked-terminal lags the v7 runtime API, which returns a MarkedExtension
marked.use(markedTerminal() as unknown as MarkedExtension)

export default function Markdown({ children }: { children: string }) {
  return <Text>{(marked.parse(children) as string).trim()}</Text>
}
