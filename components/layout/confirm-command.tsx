import { Box, Text } from "ink"
import { isDangerousCommand } from "../../lib/command-risk"
import { t } from "../../lib/i18n"
import { Menu } from "../menu"

/**
 * Yes/No gate shown in place of the input field while a run_command call is
 * awaiting approval. Mounted only while unresolved — selecting either option
 * hands off to the caller, which feeds the outcome back to the agent.
 * While `running` (approved and the command is executing) the menu is
 * replaced by a status line: the command can take a while and Menu would
 * otherwise sit there fully interactive with no sign anything happened.
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

  return (
    <Box flexDirection="column" flexShrink={0} width="100%">
      <Text color={color}>{dangerous ? `⚠ ${description}` : description}</Text>
      <Text color={color}>{`$ ${command}`}</Text>
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
