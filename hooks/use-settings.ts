import { useStdout } from "ink"
import { useState } from "react"
import { saveSettings } from "../lib/config"
import { log } from "../lib/logger"
import type { KajaSettings } from "../schemas/config"

/**
 * In-app preferences (thinking/sounds), seeded from the config file and
 * written back on every toggle. Toggling thinking also owns the timeline
 * redraw trick: <Static> output is printed to the terminal permanently, so
 * hiding or re-showing already-printed reasoning means wiping the screen
 * (incl. scrollback) and bumping `timelineEpoch`, which remounts <Static>
 * via its key so it reprints the whole timeline under the new setting.
 */
export function useSettings(initial?: KajaSettings) {
  const [thinking, setThinking] = useState(initial?.thinking ?? true)
  const [sounds, setSounds] = useState(initial?.sounds ?? true)
  // Spoken replies are opt-in: they need the speaches TTS server running.
  const [voice, setVoice] = useState(initial?.voice ?? false)
  const [timelineEpoch, setTimelineEpoch] = useState(0)
  const { write } = useStdout()

  const persist = (settings: KajaSettings) => {
    saveSettings(settings).catch((error) => {
      log.warn({ error }, "Failed to save settings")
    })
  }

  // Wipe the screen (incl. scrollback) and remount <Static> via its key so
  // the whole timeline reprints under the current settings/model.
  const redraw = () => {
    write("\x1b[2J\x1b[3J\x1b[H")
    setTimelineEpoch((prev) => prev + 1)
  }

  const toggleThinking = () => {
    persist({ thinking: !thinking, sounds, voice })
    setThinking(!thinking)
    redraw()
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
    toggleVoice,
    timelineEpoch,
    redraw
  }
}
