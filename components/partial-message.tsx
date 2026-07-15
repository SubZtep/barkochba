import { Text } from "ink"
import type { PartialMessage as PartialMessageData } from "../hooks/use-agent"
import { ReasoningBox } from "./reasoning-box"

/** The in-flight streaming message: reasoning (if shown) plus content. */
export function PartialMessage({
  partial,
  thinking
}: {
  partial: PartialMessageData | null
  thinking: boolean
}) {
  if (!partial) return null
  return (
    <>
      {thinking && partial.reasoning !== "" && (
        <ReasoningBox>{partial.reasoning}</ReasoningBox>
      )}
      {partial.content !== "" && <Text>{partial.content}</Text>}
    </>
  )
}
