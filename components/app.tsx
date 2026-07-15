import { Box } from "ink"
import { useAgent } from "../hooks/use-agent"
import { useSettings } from "../hooks/use-settings"
import { useSound } from "../hooks/use-sound"
import type { KajaSettings } from "../lib/config"
import { defaultTools } from "../tools"
import { PartialMessage } from "./partial-message"
import { Timeline } from "./timeline"
import { UserInput } from "./user-input"

export default function App({
  name = "Stranger",
  initialSettings
}: {
  name: string | undefined
  initialSettings?: KajaSettings
}) {
  const { agent, events, partial, pending, send } = useAgent({
    model: process.env.OPENAI_API_MODEL!,
    tools: defaultTools
  })
  const { thinking, sounds, toggleThinking, toggleSounds, timelineEpoch } =
    useSettings(initialSettings)
  useSound(events, sounds)

  // Slash menu (opened by typing "/" in the input): label + action together.
  const commands = [
    {
      label: `Toggle thinking [${thinking ? "on" : "off"}]`,
      run: toggleThinking
    },
    { label: `Toggle sounds [${sounds ? "on" : "off"}]`, run: toggleSounds },
    // Model switching isn't wired up yet — the model comes from the config
    // at startup and the agent is constructed once.
    { label: "Change model", run: () => {} }
  ]

  return (
    <Box flexDirection="column">
      <Timeline
        events={events}
        epoch={timelineEpoch}
        thinking={thinking}
        model={agent.model}
        name={name}
      />
      <PartialMessage partial={partial} thinking={thinking} />
      <UserInput
        pending={pending}
        send={send}
        menuItems={commands.map((command) => command.label)}
        onMenuSelect={(index) => commands[index]?.run()}
      />
    </Box>
  )
}
