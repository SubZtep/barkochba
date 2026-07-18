/**
 * Runs a shell command and returns a plain-text summary (exit code plus any
 * stdout/stderr) suitable to feed straight back to the model as a tool
 * result. Only called after the human has approved the command.
 */
export async function runShellCommand(command: string): Promise<string> {
  const proc = Bun.spawn(["sh", "-c", command], {
    stdout: "pipe",
    stderr: "pipe"
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ])

  const parts = [`Exit code: ${exitCode}`]
  if (stdout.trim()) parts.push(`stdout:\n${stdout.trim()}`)
  if (stderr.trim()) parts.push(`stderr:\n${stderr.trim()}`)
  return parts.join("\n\n")
}
