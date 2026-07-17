import { useState } from "react"
import { saveSettings } from "../lib/config"
import { log } from "../lib/logger"
import type { KajaSettings } from "../schemas/config"

/**
 * In-app preferences (thinking/sounds/voice), seeded from the config file and
 * written back on every toggle. With a live (non-Static) timeline, toggles
 * take effect on the next React render — no terminal wipe required.
 */
export function useSettings(initial?: KajaSettings) {
  const [thinking, setThinking] = useState(initial?.thinking ?? true)
  const [sounds, setSounds] = useState(initial?.sounds ?? true)
  // Spoken replies are opt-in: they need the speaches TTS server running.
  const [voice, setVoice] = useState(initial?.voice ?? false)

  const persist = (settings: KajaSettings) => {
    saveSettings(settings).catch((error) => {
      log.warn({ error }, "Failed to save settings")
    })
  }

  const toggleThinking = () => {
    persist({ thinking: !thinking, sounds, voice })
    setThinking(!thinking)
  }

  const toggleSounds = () => {
    persist({ thinking, sounds: !sounds, voice })
    setSounds(!sounds)
  }

  const toggleVoice = () => {
    persist({ thinking, sounds, voice: !voice })
    setVoice(!voice)
  }

  return {
    thinking,
    sounds,
    voice,
    toggleThinking,
    toggleSounds,
    toggleVoice
  }
}
