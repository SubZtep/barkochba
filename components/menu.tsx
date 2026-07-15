import { Box, Text, useInput } from "ink"
import { ScrollList } from "ink-scroll-list"
import { useState } from "react"

/**
 * Keyboard-driven selection list: up/down to move, return to pick, escape
 * (or backspace) to dismiss. Selection state lives here, so mount it only
 * while the menu is open and it starts fresh each time.
 */
export function Menu({
  items,
  onSelect,
  onClose
}: {
  items: string[]
  onSelect: (index: number) => void
  onClose: () => void
}) {
  const [selectedIndex, setSelectedIndex] = useState(0)

  useInput((_input, key) => {
    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(prev + 1, items.length - 1))
    }
    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(prev - 1, 0))
    }
    if (key.return) {
      onSelect(selectedIndex)
    }
    if (key.escape || key.backspace || key.delete) {
      onClose()
    }
  })

  return (
    <ScrollList
      height={Math.min(items.length, 5)}
      selectedIndex={selectedIndex}
    >
      {items.map((item, i) => (
        <Box key={item}>
          <Text color={i === selectedIndex ? "blue" : "white"}>
            {i === selectedIndex ? "> " : "  "}
            {item}
          </Text>
        </Box>
      ))}
    </ScrollList>
  )
}
