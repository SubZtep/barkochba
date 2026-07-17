import { Box, Text } from "ink"
import { useEffect, useState } from "react"

const IDLE = "༼☉ɷ⊙༽" as const

const ANIMATIONS = {
  blink: [
    ["༼–ɷ⊙༽", 120],
    [IDLE, 0]
  ],
  smile: [
    ["༼☉ω⊙༽", 250],
    ["༼☉ɷ⊙༽", 150],
    ["༼☉ω⊙༽", 250],
    [IDLE, 0]
  ],
  wink: [
    ["༼–ɷ⊙༽", 150],
    ["༼☉ɷ⊙༽", 150],
    ["༼☉ɷ–༽", 150],
    [IDLE, 0]
  ]
} as const

type MonsterAnimation = keyof typeof ANIMATIONS
type MonsterFrame = (typeof ANIMATIONS)[MonsterAnimation][number][0]

export function Monster({
  eventName,
  onDone
}: {
  eventName: MonsterAnimation | null
  onDone: () => void
}) {
  const [frame, setFrame] = useState<MonsterFrame>(IDLE)

  useEffect(() => {
    if (!eventName || !ANIMATIONS[eventName]) return

    const sequence = ANIMATIONS[eventName]
    let step = 0
    let timer: NodeJS.Timeout

    const advance = () => {
      const [f, hold] = sequence[step]
      setFrame(f)
      step += 1
      if (step < sequence.length) {
        timer = setTimeout(advance, hold)
      } else {
        onDone()
      }
    }
    advance()

    return () => clearTimeout(timer)
  }, [eventName])

  return (
    <Box>
      <Text color="#ff1493" bold>
        {frame}
      </Text>
    </Box>
  )
}

export function MonsterMate() {
  const [eventName, setEventName] = useState<MonsterAnimation | null>(null)

  /** Weighted: mostly blinks, occasional personality */
  const pick = () => {
    const r = Math.random()
    if (r < 0.75) return "blink"
    if (r < 0.9) return "smile"
    return "wink"
  }

  useEffect(() => {
    let timer: NodeJS.Timeout

    const scheduleNext = () => {
      /** 4s - 10s */
      const delay = 4000 + Math.random() * 6000
      timer = setTimeout(() => setEventName(pick()), delay)
    }

    scheduleNext()
    return () => clearTimeout(timer)
  }, [eventName])

  return <Monster eventName={eventName} onDone={() => setEventName(null)} />
}
