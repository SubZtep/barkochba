import { Box, Text } from "ink"
import TextInput from "ink-text-input"
import { useEffect, useState } from "react"

export function UserInput({
  pending,
  send
}: {
  pending: boolean
  send: (prompt: string) => Promise<void>
}) {
  const [input, setInput] = useState("")
  const [idle, setIdle] = useState(0)

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

  const Border = idle > 10 ? PowerBorder : SolidBorder

  return (
    <Border>
      <TextInput
        value={input}
        focus={!pending}
        onChange={setInput}
        onSubmit={handleSubmit}
        showCursor={idle % 2 === 0}
      />
    </Border>
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
