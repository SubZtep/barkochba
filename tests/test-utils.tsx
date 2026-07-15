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
  const stdout = new EventEmitter() as any
  stdout.isTTY = true
  stdout.columns = 80
  stdout.rows = 24
  stdout.write = (chunk: string) => {
    chunks.push(chunk)
    return true
  }

  const app = render(node, {
    stdout,
    stdin,
    exitOnCtrlC: false,
    patchConsole: false
  })

  const tick = () => new Promise((resolve) => setTimeout(resolve, 100))

  return {
    ...app,
    tick,
    /** Feed raw key bytes to stdin and wait for Ink to repaint. */
    press: async (data: string) => {
      stdin.push(data)
      await tick()
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
