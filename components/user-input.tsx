import { Box, Text, useInput } from "ink"
import { useEffect, useState } from "react"
import { useDictation } from "../hooks/use-dictation"
import { Menu } from "./menu"
import { TextInput } from "./text-input"

export function UserInput({
  pending,
  speaking,
  send,
  menuItems,
  onMenuSelect,
  onMenuClose
}: {
  pending: boolean
  /** The agent's voice is audibly playing — mute the mic so it isn't heard. */
  speaking: boolean
  send: (prompt: string) => Promise<void>
  menuItems: string[]
  /** Return true to keep the menu open (the caller swapped in a submenu). */
  // biome-ignore lint/suspicious/noConfusingVoidType: most handlers naturally return nothing; only a literal `true` is meaningful
  onMenuSelect: (index: number) => boolean | void
  onMenuClose?: () => void
}) {
  const [input, setInput] = useState("")
  const [idle, setIdle] = useState(0)
  const [mic, setMic] = useState(false)

  // Ctrl+T toggles dictation; transcribed phrases land in the input for
  // review, so a garbled transcript can be fixed before enter sends it.
  useInput((char, key) => {
    if (key.ctrl && char === "t") setMic((prev) => !prev)
  })
  // Half-duplex: while the agent's voice plays, the mic is paused (captured
  // audio dropped) so it doesn't transcribe the agent talking to itself.
  const sttState = useDictation(mic && !speaking, (text) => {
    setInput((prev) => (prev ? `${prev} ${text}` : text))
  })

  // What the input box leads with: quiet chat bubble, or the mic's progress —
  // deaf while the agent speaks, waiting for speech, hearing it, or (slowly)
  // turning it into text.
  const icon = !mic
    ? "🗨️  "
    : speaking
      ? "🙉  "
      : sttState === "recording"
        ? "👂  "
        : sttState === "transcribing"
          ? "⏳  "
          : "🎤  "

  // Typing "/" as the first character opens the menu; while it's open the
  // text input is unfocused so arrows/return/escape drive the menu instead.
  const menuOpen = input.startsWith("/")
  const closeMenu = () => {
    setInput("")
    onMenuClose?.()
  }

  useEffect(() => {
    const timer = setInterval(() => {
      setIdle((idle) => idle + 1)
    }, 1000)

    return () => {
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    setIdle(0)
  }, [pending, input])

  const handleSubmit = (value: string) => {
    if (!value.trim() || pending) return
    setInput("")
    send(value)
  }

  const Border = idle > 30 ? PowerBorder : SolidBorder

  return (
    <Box flexDirection="column">
      {menuOpen && (
        <Menu
          // Remount when the items change (main menu <-> submenu), so the
          // selection starts fresh instead of inheriting the previous one.
          key={menuItems.join("\n")}
          items={menuItems}
          onSelect={(index) => {
            if (!onMenuSelect(index)) closeMenu()
          }}
          onClose={closeMenu}
        />
      )}
      <Border icon={icon}>
        <TextInput
          value={input}
          focus={!pending && !menuOpen}
          onChange={setInput}
          onSubmit={handleSubmit}
          showCursor={!mic || (sttState === "listening" && idle % 2 === 0)}
          placeholder={idle > 20 ? undefined : "Press `/` for menu"}
        />
      </Border>
    </Box>
  )
}

/**
 * Icon is inline with the field text so long input wraps as one stream —
 * continuation lines start at the left edge of the box, not under a gutter.
 */
function InputRow({
  icon,
  children
}: {
  icon: string
  children: React.ReactNode
}) {
  return (
    <Text color="whiteBright">
      {icon}
      {children}
    </Text>
  )
}

function SolidBorder({
  icon,
  children
}: {
  icon: string
  children: React.ReactNode
}) {
  return (
    <Box backgroundColor="#202040" padding={1} marginTop={1}>
      <InputRow icon={icon}>{children}</InputRow>
    </Box>
  )
}

function PowerBorder({
  icon,
  children
}: {
  icon: string
  children: React.ReactNode
}) {
  return (
    <Box
      backgroundColor="#202040"
      padding={0}
      marginTop={1}
      borderStyle="arrow"
      borderColor="green"
      borderDimColor
    >
      <InputRow icon={icon}>{children}</InputRow>
    </Box>
  )
}
