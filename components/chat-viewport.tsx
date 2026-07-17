import { Box, useInput, useStdout, useWindowSize } from "ink"
import { ScrollView, type ScrollViewRef } from "ink-scroll-view"
import { useEffect, useRef } from "react"
import type {
  PartialMessage as PartialMessageData,
  TimelineEvent
} from "../hooks/use-agent"
import { Activity } from "./activity"
import { PartialMessage } from "./partial-message"
import { TimelineItem } from "./timeline"

/**
 * Scrollable middle pane: finalized history + streaming partial + activity.
 * Uses ink-scroll-view for measured line offsets (not flex-end clipping).
 *
 * Keys (don't clash with the text field's left/right/home/end):
 *   PageUp / PageDown — page by viewport
 *   Ctrl+Up / Ctrl+Down — a few lines
 *   Ctrl+Home / Ctrl+End — top / bottom (stick resumes at bottom)
 *
 * While the view is pinned to the bottom, new content auto-follows; after the
 * user scrolls up, the pin releases until they PageDown/Ctrl+End to the end.
 */
export function ChatViewport({
  events,
  thinking,
  partial,
  pending
}: {
  events: TimelineEvent[]
  thinking: boolean
  partial: PartialMessageData | null
  pending: boolean
}) {
  const scrollRef = useRef<ScrollViewRef>(null)
  const stickToBottom = useRef(true)
  const { columns, rows } = useWindowSize()
  const { stdout } = useStdout()

  const remeasure = () => {
    scrollRef.current?.remeasure()
  }

  // Parent layout / terminal resize: ScrollView needs an explicit remeasure
  // after width *and* height change (footer/header row budget shifts).
  useEffect(() => {
    // Next frame: let Yoga assign the new flex heights first.
    const timer = setTimeout(remeasure, 0)
    return () => clearTimeout(timer)
  }, [columns, rows])

  useEffect(() => {
    if (!stdout) return
    const onResize = () => {
      setTimeout(remeasure, 0)
    }
    stdout.on("resize", onResize)
    return () => {
      stdout.off("resize", onResize)
    }
  }, [stdout])

  const followIfPinned = () => {
    if (stickToBottom.current) {
      scrollRef.current?.scrollToBottom()
    }
  }

  // New messages / streaming tokens: keep the tail in view when pinned.
  useEffect(() => {
    followIfPinned()
  }, [events, partial, pending, thinking])

  const updateStickFromOffset = (offset: number) => {
    const bottom = scrollRef.current?.getBottomOffset() ?? 0
    stickToBottom.current = offset >= bottom
  }

  useInput((_input, key) => {
    const view = scrollRef.current
    if (!view) return

    const page = Math.max(1, (view.getViewportHeight() || 10) - 1)

    if (key.pageUp) {
      stickToBottom.current = false
      view.scrollBy(-page)
      return
    }
    if (key.pageDown) {
      view.scrollBy(page)
      updateStickFromOffset(view.getScrollOffset())
      return
    }
    if (key.ctrl && key.upArrow) {
      stickToBottom.current = false
      view.scrollBy(-3)
      return
    }
    if (key.ctrl && key.downArrow) {
      view.scrollBy(3)
      updateStickFromOffset(view.getScrollOffset())
      return
    }
    if (key.ctrl && key.home) {
      stickToBottom.current = false
      view.scrollToTop()
      return
    }
    if (key.ctrl && key.end) {
      stickToBottom.current = true
      view.scrollToBottom()
    }
  })

  return (
    <Box
      flexGrow={1}
      flexShrink={1}
      flexBasis={0}
      minHeight={3}
      flexDirection="column"
      overflow="hidden"
      width="100%"
    >
      <ScrollView
        ref={scrollRef}
        flexGrow={1}
        flexShrink={1}
        width="100%"
        onScroll={updateStickFromOffset}
        onContentHeightChange={() => {
          // Height changes mid-stream; re-pin without waiting for another tick.
          followIfPinned()
        }}
        onViewportSizeChange={() => {
          followIfPinned()
        }}
      >
        {events.map((item, i) => (
          <Box key={`e-${i}`}>
            <TimelineItem item={item} thinking={thinking} />
          </Box>
        ))}
        <Box key="partial">
          <PartialMessage partial={partial} thinking={thinking} />
        </Box>
        <Box key="activity">
          <Activity pending={pending} partial={partial} thinking={thinking} />
        </Box>
      </ScrollView>
    </Box>
  )
}
