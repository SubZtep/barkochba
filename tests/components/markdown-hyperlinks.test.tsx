import { expect, test } from "bun:test"
import path from "node:path"

// marked-terminal decides whether to emit a real OSC 8 hyperlink (clickable)
// or fall back to plain "text (url)" based on `supports-hyperlinks`, which
// reads TERM/TERM_PROGRAM once at module load. That load-order sensitivity
// means the only faithful way to test it is a fresh subprocess with a
// controlled, hostile env - mimicking cli.tsx's actual startup order rather
// than duplicating its logic inline. See cli.tsx's FORCE_HYPERLINK comment.
const OSC8_LINK = "]8;;https://example.comclick me]8;;"
const PLAIN_FALLBACK = "click me (https://example.com)"

const repoRoot = path.resolve(import.meta.dir, "../..")

// A TERM value that supports-hyperlinks' allowlist does not recognize (this
// is what Alacritty reports unless TERM is literally "alacritty"), and no
// TERM_PROGRAM/VTE_VERSION/WT_SESSION to hint otherwise.
const hostileEnv = {
  ...process.env,
  TERM: "xterm-256color",
  TERM_PROGRAM: "",
  TERM_PROGRAM_VERSION: "",
  VTE_VERSION: "",
  WT_SESSION: "",
  FORCE_HYPERLINK: ""
}

async function renderLinkInSubprocess(env: Record<string, string>) {
  const script = `
    if (!process.env.FORCE_HYPERLINK) process.env.FORCE_HYPERLINK = "1"
    const { markedTerminal } = await import("marked-terminal")
    const { marked } = await import("marked")
    marked.use(markedTerminal())
    process.stdout.write(marked.parse("[click me](https://example.com)"))
  `
  const proc = Bun.spawn(["bun", "-e", script], {
    cwd: repoRoot,
    env,
    stdout: "pipe",
    stderr: "pipe"
  })
  const out = await new Response(proc.stdout).text()
  await proc.exited
  return out
}

test("links render as clickable OSC 8 hyperlinks even under a terminal supports-hyperlinks doesn't recognize", async () => {
  const out = await renderLinkInSubprocess(hostileEnv)
  expect(out).toContain(OSC8_LINK)
  expect(out).not.toContain(PLAIN_FALLBACK)
})

test("without the FORCE_HYPERLINK fix, the same hostile env would degrade to plain text (regression guard)", async () => {
  const out = await renderLinkInSubprocess({
    ...hostileEnv,
    FORCE_HYPERLINK: "0"
  })
  expect(out).toContain(PLAIN_FALLBACK)
  expect(out).not.toContain(OSC8_LINK)
})
