import { Box, useWindowSize } from "ink"
import { useState } from "react"
import { useAgent } from "../hooks/use-agent"
import { useGeoLocation } from "../hooks/use-geo-location"
import { useSettings } from "../hooks/use-settings"
import { useSound } from "../hooks/use-sound"
import { useVoice } from "../hooks/use-voice"
import { personas } from "../lib/personas"
import type { KajaSettings } from "../schemas/config"
import type { ResolvedModel } from "../schemas/models"
import { defaultTools } from "../tools"
import { ChatViewport } from "./chat-viewport"
import { Header } from "./header"
import { UserInput } from "./user-input"

export default function App({
  initialSettings,
  models = []
}: {
  initialSettings?: KajaSettings
  models?: ResolvedModel[]
}) {
  const {
    model,
    switchModel,
    persona,
    switchPersona,
    events,
    partial,
    pending,
    send
  } = useAgent({
    model: process.env.OPENAI_API_MODEL!,
    tools: defaultTools
  })
  const { thinking, sounds, voice, toggleThinking, toggleSounds, toggleVoice } =
    useSettings(initialSettings)
  useSound(events, sounds)
  const speaking = useVoice(events, voice)
  const { location } = useGeoLocation()
  const { columns, rows } = useWindowSize()

  const chatModels = models.filter((m) => m.task === "chat")
  const [menuMode, setMenuMode] = useState<"main" | "model" | "persona">("main")

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
          },
          {
            label: "Change persona",
            run: () => {
              setMenuMode("persona")
              return true
            }
          }
        ]
      : menuMode === "persona"
        ? personas.map((p) => ({
            label: `${p.label}${p.id === persona.id ? " ✓" : ""}`,
            run: () => {
              switchPersona(p)
            }
          }))
        : chatModels.map((chatModel) => ({
            label: `${chatModel.label ?? chatModel.id}${
              chatModel.id === model ? " ✓" : ""
            }`,
            run: () => {
              switchModel(chatModel)
            }
          }))

  // Full-viewport column. Header + footer must not shrink (Ink Box defaults to
  // flexShrink:1) or resize steals rows from them and the input collapses.
  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Box flexShrink={0} width="100%">
        <Header model={model} location={location?.country.name} />
      </Box>
      <ChatViewport
        events={events}
        thinking={thinking}
        partial={partial}
        pending={pending}
      />
      <Box flexShrink={0} width="100%">
        <UserInput
          pending={pending}
          speaking={speaking}
          send={send}
          menuItems={commands.map((command) => command.label)}
          onMenuSelect={(index) => commands[index]?.run()}
          onMenuClose={() => setMenuMode("main")}
        />
      </Box>
    </Box>
  )
}
