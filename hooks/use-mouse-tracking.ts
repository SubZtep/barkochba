import { useStdout } from "ink"
import { useEffect } from "react"
import { MOUSE_DISABLE, MOUSE_ENABLE } from "../lib/terminal-input"

/**
 * Enable terminal mouse reporting for the lifetime of the component tree.
 * Wheel/click CSI sequences then arrive on stdin for ChatViewport to parse.
 * Always disables on unmount / process exit so the shell is not left sticky.
 */
export function useMouseTracking(enabled = true) {
  const { stdout } = useStdout()

  useEffect(() => {
    if (!enabled || !stdout) return

    const write = (s: string) => {
      try {
        stdout.write(s)
      } catch {
        // non-TTY or already closed
      }
    }

    write(MOUSE_ENABLE)

    const disable = () => write(MOUSE_DISABLE)
    process.on("exit", disable)
    // Best-effort on signals; exit handler still runs after.
    process.on("SIGINT", disable)
    process.on("SIGTERM", disable)

    return () => {
      process.off("exit", disable)
      process.off("SIGINT", disable)
      process.off("SIGTERM", disable)
      disable()
    }
  }, [enabled, stdout])
}
