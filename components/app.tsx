import { Box } from "ink"
import { useState } from "react"
import { useAgent } from "../hooks/use-agent"
import { useSettings } from "../hooks/use-settings"
import { useSound } from "../hooks/use-sound"
import { useVoice } from "../hooks/use-voice"
import type { KajaSettings } from "../schemas/config"
import type { ResolvedModel } from "../schemas/models"
import { defaultTools } from "../tools"
import { Activity } from "./activity"
import { PartialMessage } from "./partial-message"
import { Timeline } from "./timeline"
import { UserInput } from "./user-input"

export default function App({
  name = "Stranger",
  initialSettings,
  models = []
}: {
  name: string | undefined
  initialSettings?: KajaSettings
  models?: ResolvedModel[]
}) {
  const { model, switchModel, events, partial, pending, send } = useAgent({
    model: process.env.OPENAI_API_MODEL!,
    tools: defaultTools
  })
  const {
    thinking,
    sounds,
    voice,
    toggleThinking,
    toggleSounds,
    toggleVoice,
    timelineEpoch,
    redraw
  } = useSettings(initialSettings)
  useSound(events, sounds)
  useVoice(events, voice)

  const chatModels = models.filter((m) => m.task === "chat")
  const [menuMode, setMenuMode] = useState<"main" | "model">("main")

  // Slash menu (opened by typing "/" in the input): label + action together.
  // An action returning true keeps the menu open (it swapped in a submenu).
  // biome-ignore lint/suspicious/noConfusingVoidType: matches UserInput's onMenuSelect contract
  const commands: { label: string; run: () => boolean | void }[] =
    menuMode === "main"
      ? [
          {
            label: `Toggle thinking [${thinking ? "on" : "off"}]`,
            run: toggleThinking
          },
          {
            label: `Toggle sounds [${sounds ? "on" : "off"}]`,
            run: toggleSounds
          },
          {
            label: `Toggle voice [${voice ? "on" : "off"}]`,
            run: toggleVoice
          },
          {
            label: "Change model",
            run: () => {
              if (chatModels.length === 0) return
              setMenuMode("model")
              return true
            }
          }
        ]
      : chatModels.map((chatModel) => ({
          label: `${chatModel.label ?? chatModel.id}${
            chatModel.id === model ? " ✓" : ""
          }`,
          run: () => {
            switchModel(chatModel)
            // Reprint the timeline so the header shows the new model.
            redraw()
          }
        }))

  return (
    <Box flexDirection="column">
      <Timeline
        events={events}
        epoch={timelineEpoch}
        thinking={thinking}
        model={model}
        name={name}
      />
      <PartialMessage partial={partial} thinking={thinking} />
      <Activity pending={pending} partial={partial} thinking={thinking} />
      <UserInput
        pending={pending}
        send={send}
        menuItems={commands.map((command) => command.label)}
        onMenuSelect={(index) => commands[index]?.run()}
        onMenuClose={() => setMenuMode("main")}
      />
    </Box>
  )
}
