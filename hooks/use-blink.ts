import { useEffect, useState } from "react"

/**
 * Toggles every `intervalMs`, for a blinking cursor. Pure rendering signal —
 * callers must not gate input handling on it (that made arrow keys/Home/End
 * stop working every other second when `showCursor` did double duty as both
 * "field has a cursor" and "cursor is in its visible blink phase").
 */
export function useBlink(intervalMs: number, active: boolean): boolean {
  const [on, setOn] = useState(true)

  useEffect(() => {
    if (!active) {
      setOn(true)
      return
    }
    const timer = setInterval(() => {
      setOn((prev) => !prev)
    }, intervalMs)

    return () => {
      clearInterval(timer)
    }
  }, [intervalMs, active])

  return on
}
