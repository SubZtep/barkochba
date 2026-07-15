import { Box, Text } from "ink"
import TextInput from "ink-text-input"
import { useEffect, useState } from "react"
import { Menu } from "./menu"

export function UserInput({
  pending,
  send,
  menuItems,
  onMenuSelect
}: {
  pending: boolean
  send: (prompt: string) => Promise<void>
  menuItems: string[]
  onMenuSelect: (index: number) => void
}) {
  const [input, setInput] = useState("")
  const [idle, setIdle] = useState(0)

  // Typing "/" as the first character opens the menu; while it's open the
  // text input is unfocused so arrows/return/escape drive the menu instead.
  const menuOpen = input.startsWith("/")
  const closeMenu = () => setInput("")

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
          items={menuItems}
          onSelect={(index) => {
            onMenuSelect(index)
            closeMenu()
          }}
          onClose={closeMenu}
        />
      )}
      <Border>
        <TextInput
          value={input}
          focus={!pending && !menuOpen}
          onChange={setInput}
          onSubmit={handleSubmit}
          showCursor={idle % 2 === 0}
        />
      </Border>
    </Box>
  )
}

function SolidBorder({ children }: { children: React.ReactNode }) {
  return (
    <Box backgroundColor="#202040" padding={1} marginTop={1}>
      <Text>{"🗨️  "}</Text>
      <Text color="whiteBright">{children}</Text>
    </Box>
  )
}

function PowerBorder({ children }: { children: React.ReactNode }) {
  return (
    <Box
      backgroundColor="#202040"
      padding={0}
      marginTop={1}
      borderStyle="arrow"
      borderColor="green"
      borderDimColor
    >
      <Text>{"🗨️  "}</Text>
      <Text color="whiteBright">{children}</Text>
    </Box>
  )
}
