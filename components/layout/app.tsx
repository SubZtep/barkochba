import { Box, useWindowSize } from "ink"
import { useState } from "react"
import { useAgent } from "../../hooks/use-agent"
import { useGeoLocation } from "../../hooks/use-geo-location"
import { useSettings } from "../../hooks/use-settings"
import { useSound } from "../../hooks/use-sound"
import { useVoice } from "../../hooks/use-voice"
import type { Tool } from "../../lib/agents"
import { t } from "../../lib/i18n"
import type { Persona } from "../../lib/personas"
import type { KajaSettings } from "../../schemas/config"
import type { ResolvedModel } from "../../schemas/models"
import type { PersistedSession } from "../../schemas/session"
import { ChatViewport } from "./chat-viewport"
import { ConfirmCommand } from "./confirm-command"
import { Header } from "./header"
import { UserInput } from "./user-input"

export default function App({
  initialSettings,
  models = [],
  personas,
  openaiApiModel,
  tools,
  initialSession,
  promptHistory
}: {
  initialSettings?: KajaSettings
  models?: ResolvedModel[]
  personas: Persona[]
  openaiApiModel: string
  tools: Tool<any>[]
  /** A persisted session to continue (--continue / --session <id>). */
  initialSession?: PersistedSession
  /** Past prompts across all sessions for ↑/↓ recall, newest first. */
  promptHistory?: string[]
}) {
  const {
    model,
    switchModel,
    persona,
    switchPersona,
    events,
    partial,
    pending,
    send,
    resolveCommand,
    runningCommand
  } = useAgent({
    model: openaiApiModel,
    tools,
    personas,
    // A stored persona/model that no longer exists resolves to undefined and
    // the resume proceeds with defaults — messages restore verbatim anyway.
    resume: initialSession && {
      session: initialSession,
      persona: personas.find((p) => p.id === initialSession.persona),
      model: models.find((m) => m.id === initialSession.model)
    }
  })
  const lastEvent = events.at(-1)
  const pendingCommand =
    !pending && lastEvent?.type === "confirm_command" ? lastEvent : undefined
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
            label: t("menu.toggleThinking", {
              state: t(thinking ? "menu.on" : "menu.off")
            }),
            run: toggleThinking
          },
          {
            label: t("menu.toggleSounds", {
              state: t(sounds ? "menu.on" : "menu.off")
            }),
            run: toggleSounds
          },
          {
            label: t("menu.toggleVoice", {
              state: t(voice ? "menu.on" : "menu.off")
            }),
            run: toggleVoice
          },
          {
            label: t("menu.changeModel"),
            run: () => {
              if (chatModels.length === 0) return
              setMenuMode("model")
              return true
            }
          },
          {
            label: t("menu.changePersona"),
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

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Header model={model} location={location?.country.name} />
      <ChatViewport
        events={events}
        thinking={thinking}
        partial={partial}
        pending={pending}
        bottomChromeKey={
          pendingCommand ? (runningCommand ? "running" : "confirm") : "input"
        }
      />
      {pendingCommand ? (
        <ConfirmCommand
          key="confirm-command"
          command={pendingCommand.command}
          description={pendingCommand.description}
          running={runningCommand}
          onResolve={(approved) =>
            resolveCommand(pendingCommand.command, approved)
          }
        />
      ) : (
        <UserInput
          key="user-input"
          pending={pending}
          speaking={speaking}
          send={send}
          history={promptHistory}
          menuItems={commands.map((command) => command.label)}
          onMenuSelect={(index) => commands[index]?.run()}
          onMenuClose={() => setMenuMode("main")}
        />
      )}
    </Box>
  )
}
