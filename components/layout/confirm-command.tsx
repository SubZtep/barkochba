import { Box, Text } from "ink"
import { isDangerousCommand } from "../../lib/command-risk"
import { t } from "../../lib/i18n"
import { Menu } from "../menu"

const MAX_COMMAND_LINES = 6

/**
 * Yes/No gate shown in place of the input field while a run_command call is
 * awaiting approval. Mounted only while unresolved — selecting either option
 * hands off to the caller, which feeds the outcome back to the agent.
 * While `running` (approved and the command is executing) the menu is
 * replaced by a status line: the command can take a while and Menu would
 * otherwise sit there fully interactive with no sign anything happened.
 *
 * The command preview is capped at MAX_COMMAND_LINES: a generated multi-line
 * script (e.g. a Python heredoc) can otherwise grow tall enough to push the
 * Menu below the terminal's visible rows, leaving it unreachable.
 */
export function ConfirmCommand({
  command,
  description,
  running,
  onResolve
}: {
  command: string
  description: string
  running: boolean
  onResolve: (approved: boolean) => void
}) {
  const dangerous = isDangerousCommand(command)
  const color = dangerous ? "red" : "yellow"
  const lines = command.split("\n")
  const preview = lines.slice(0, MAX_COMMAND_LINES).join("\n")
  const hiddenLines = lines.length - MAX_COMMAND_LINES

  return (
    <Box flexDirection="column" flexShrink={0} width="100%">
      <Text color={color}>{dangerous ? `⚠ ${description}` : description}</Text>
      <Text color={color}>{`$ ${preview}`}</Text>
      {hiddenLines > 0 && (
        <Text dimColor>
          {t("confirmCommand.truncated", { count: hiddenLines })}
        </Text>
      )}
      {running ? (
        <Text dimColor>{t("confirmCommand.running")}</Text>
      ) : (
        <Menu
          items={[t("confirmCommand.yes"), t("confirmCommand.no")]}
          onSelect={(index) => onResolve(index === 0)}
          onClose={() => onResolve(false)}
        />
      )}
    </Box>
  )
}
