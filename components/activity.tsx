import { Text } from "ink"
import { useEffect, useState } from "react"
import type { PartialMessage } from "../hooks/use-agent"
import { t } from "../lib/i18n"
import { Spinner } from "./elem/spinner"

const TICK_MS = 120

/** Rough token estimate from streamed text (~4 characters per token). */
function estimateTokens(partial: PartialMessage | null) {
  if (!partial) return 0
  return Math.round((partial.reasoning.length + partial.content.length) / 4)
}

/**
 * Activity line shown while a run is in flight but nothing is visibly
 * streaming — i.e. before the first token, or while reasoning streams with
 * the thinking display off. A spinner plus elapsed time and a rough token
 * count, so the terminal never looks stuck.
 */
export function Activity({
  pending,
  partial,
  thinking
}: {
  pending: boolean
  partial: PartialMessage | null
  thinking: boolean
}) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!pending) return
    setTick(0)
    const timer = setInterval(() => setTick((t) => t + 1), TICK_MS)
    return () => clearInterval(timer)
  }, [pending])

  const contentVisible = !!partial?.content
  const reasoningVisible = thinking && !!partial?.reasoning
  if (!pending || contentVisible || reasoningVisible) return null

  const seconds = Math.floor((tick * TICK_MS) / 1000)
  const tokens = estimateTokens(partial)

  return (
    <Text color="magenta" dimColor>
      <Spinner />
      {` ${t("activity.thinking", { seconds })}${
        tokens ? t("activity.tokens", { tokens }) : ""
      }`}
    </Text>
  )
}
