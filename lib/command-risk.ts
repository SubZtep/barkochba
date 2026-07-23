/**
 * Patterns that flag a proposed shell command as risky enough to warrant a
 * louder confirm prompt. Deliberately conservative — false negatives (a
 * dangerous command that slips through unflagged) are fine, this is an
 * advisory cue, not a sandbox.
 */
const DANGEROUS_PATTERNS = [
  /\brm\s+(-\w*r\w*f|-\w*f\w*r|--recursive.*--force|--force.*--recursive)\b/i,
  /\bgit\s+push\b.*(--force|-f)\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bdrop\s+(table|database)\b/i,
  /\bsudo\b/i,
  /:\(\)\s*\{\s*:\|:&\s*\};:/, // fork bomb
  /\bmkfs(\.\w+)?\b/i,
  />\s*\/dev\/sd\w*/,
  /\bchmod\s+-R\s+\d*\s*\/(\s|$)/,
  /\bchown\s+-R\b.*\s\/(\s|$)/
] as const

/** Whether a shell command matches a known-risky pattern (rm -rf, force push, sudo, ...). */
export function isDangerousCommand(command: string): boolean {
  return DANGEROUS_PATTERNS.some((pattern) => pattern.test(command))
}
