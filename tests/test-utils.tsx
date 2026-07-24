import { EventEmitter } from "node:events"
import { Readable } from "node:stream"
import { render } from "ink"
import type { ReactNode } from "react"

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escapes requires matching the ESC byte
const ansi = /\x1b\[[0-9;?]*[a-zA-Z]/g

/**
 * Renders an Ink tree against fake TTY streams so component behavior can be
 * asserted in `bun test`: stdin is a real Readable (Ink 7 consumes input via
 * `readable` events, so plain EventEmitters won't do), stdout records every
 * chunk written for later inspection.
 */
export function renderForTest(node: ReactNode) {
  const stdin = new Readable({ read() {} }) as any
  stdin.isTTY = true
  stdin.setRawMode = () => {}
  stdin.setEncoding = () => {}
  stdin.ref = () => {}
  stdin.unref = () => {}

  const chunks: string[] = []
  // Bumped every time Ink writes a frame, so press() can wait for writes to
  // go quiet instead of sleeping a fixed duration — a wall-clock guess is
  // either wasted time on a fast repaint or, under a loaded runner (this was
  // flaky in CI even at 300ms), not long enough and reads a stale frame. A
  // single keypress can produce more than one write for the same state
  // update, so this waits for the count to stop changing, not just for the
  // first write to land.
  let writeCount = 0
  const stdout = new EventEmitter() as any
  stdout.isTTY = true
  stdout.columns = 80
  stdout.rows = 24
  stdout.write = (chunk: string) => {
    chunks.push(chunk)
    writeCount++
    return true
  }

  const app = render(node, {
    stdout,
    stdin,
    exitOnCtrlC: false,
    patchConsole: false,
    // Ink's CI autodetection (is-in-ci) would otherwise force non-interactive
    // mode here too, which stops it painting anything but the final frame.
    interactive: true
  })

  const tick = () => Bun.sleep(100)

  /**
   * Waits for output to settle after a keypress: polls until writeCount has
   * stopped growing for a short quiet window, capped by an overall deadline
   * generous enough for a loaded CI runner. A legitimately no-op keypress
   * (e.g. ↑ at the oldest history entry) never writes, so this returns as
   * soon as the initial quiet window elapses rather than waiting the full
   * deadline.
   */
  const waitForRepaint = async () => {
    const deadline = Date.now() + 2000
    let last = writeCount
    let quietSince = Date.now()
    while (Date.now() < deadline) {
      await Bun.sleep(10)
      if (writeCount !== last) {
        last = writeCount
        quietSince = Date.now()
      } else if (Date.now() - quietSince >= 60) {
        return
      }
    }
  }

  return {
    ...app,
    tick,
    /** Feed raw key bytes to stdin and wait for Ink to repaint. */
    press: async (data: string) => {
      stdin.push(data)
      await waitForRepaint()
    },
    /** The last painted frame, ANSI escapes stripped. */
    lastFrame: () => {
      for (let i = chunks.length - 1; i >= 0; i--) {
        const stripped = chunks[i]!.replace(ansi, "")
        if (stripped.trim() !== "") return stripped
      }
      return ""
    },
    /** Everything written so far, ANSI escapes stripped. */
    output: () => chunks.join("").replace(ansi, ""),
    /**
     * Returns a function capturing everything written from this point on,
     * escapes stripped — for asserting what a <Static> remount reprints.
     */
    mark: () => {
      const from = chunks.length
      return () => chunks.slice(from).join("").replace(ansi, "")
    }
  }
}
