import { Box, useApp, useInput, useWindowSize } from "ink"
import { useEffect, useState } from "react"
import { useDictation } from "../hooks/use-dictation"
import { Menu } from "./menu"
import { TextInput } from "./text-input"

/**
 * Outer box max rows (padding/border included). Content lines for the field
 * leave room for SolidBorder padding (1+1) or PowerBorder edges (~1+1).
 */
const INPUT_MAX_HEIGHT = 8
const INPUT_CONTENT_LINES = 6
/** Always 2 ASCII cells — never emoji (terminals disagree on emoji width). */
const PREFIX_COLS = 2

/**
 * Status mark for the input gutter. Pure ASCII so multi-line hang-indent
 * matches the first line exactly.
 *
 *   >  ready to type
 *   *  mic on, idle
 *   o  recording speech
 *   ~  transcribing
 *   x  mic muted while agent speaks
 */
function statusPrefix(
  mic: boolean,
  speaking: boolean,
  sttState: string
): string {
  if (!mic) return "> "
  if (speaking) return "x "
  if (sttState === "recording") return "o "
  if (sttState === "transcribing") return "~ "
  return "* "
}

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
  const { columns } = useWindowSize()
  const { exit } = useApp()

  // Typing "/" as the first character opens the menu; while it's open the
  // text input is unfocused so arrows/return/escape drive the menu instead.
  const menuOpen = input.startsWith("/")

  // Ctrl+T toggles dictation; Esc quits (menu open → Esc only closes the menu).
  useInput((char, key) => {
    if (key.ctrl && char === "t") setMic((prev) => !prev)
    if (key.escape && !menuOpen) exit()
  })
  // Half-duplex: while the agent's voice plays, the mic is paused (captured
  // audio dropped) so it doesn't transcribe the agent talking to itself.
  const sttState = useDictation(mic && !speaking, (text) => {
    setInput((prev) => (prev ? `${prev} ${text}` : text))
  })

  const prefix = statusPrefix(mic, speaking, sttState)

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
  // padding/border (~2) + fixed 2-col ASCII prefix.
  const sideChrome = 2
  const fieldColumns = Math.max(8, columns - sideChrome - PREFIX_COLS - 1)

  return (
    <Box flexDirection="column" flexShrink={0} width="100%">
      {menuOpen && (
        <Box flexShrink={0}>
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
        </Box>
      )}
      <Border>
        <TextInput
          value={input}
          focus={!pending && !menuOpen}
          onChange={setInput}
          onSubmit={handleSubmit}
          showCursor={!mic || (sttState === "listening" && idle % 2 === 0)}
          placeholder={
            idle > 20
              ? undefined
              : "`/` menu · Alt+Enter newline · PgUp history"
          }
          prefix={prefix}
          prefixCols={PREFIX_COLS}
          columns={fieldColumns}
          maxVisibleLines={INPUT_CONTENT_LINES}
        />
      </Border>
    </Box>
  )
}

function SolidBorder({ children }: { children: React.ReactNode }) {
  return (
    <Box
      backgroundColor="#202040"
      padding={1}
      width="100%"
      flexShrink={0}
      maxHeight={INPUT_MAX_HEIGHT}
      overflow="hidden"
    >
      {children}
    </Box>
  )
}

function PowerBorder({ children }: { children: React.ReactNode }) {
  return (
    <Box
      backgroundColor="#202040"
      padding={0}
      width="100%"
      flexShrink={0}
      maxHeight={INPUT_MAX_HEIGHT}
      overflow="hidden"
      borderStyle="arrow"
      borderColor="green"
      borderDimColor
    >
      {children}
    </Box>
  )
}
