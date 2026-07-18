import { Box, Text, useInput, useStdout, useWindowSize } from "ink"
import { useEffect, useMemo, useRef, useState } from "react"
import type {
  PartialMessage as PartialMessageData,
  TimelineEvent
} from "../../hooks/use-agent"
import { useMouseTracking } from "../../hooks/use-mouse-tracking"
import { t } from "../../lib/i18n"
import { isAtBottom, STICK_SLOP } from "../../lib/scroll-stick"
import {
  isTerminalMouseSequence,
  parseWheelDirection
} from "../../lib/terminal-input"
import { Activity } from "../activity"
import { VirtualScroll, type VirtualScrollRef } from "../elem/virtual-scroll"
import { PartialMessage } from "../partial-message"
import { TimelineItem } from "../timeline"

const WHEEL_LINES = 3

/**
 * Clamp to the real bottom offset (VirtualScroll clamps internally too;
 * kept here so the input handlers stay self-evidently safe).
 */
function clampScrollTo(view: VirtualScrollRef, offset: number) {
  const bottom = view.getBottomOffset()
  const next = Math.max(0, Math.min(offset, bottom))
  view.scrollTo(next)
  return next
}

function scrollByClamped(view: VirtualScrollRef, delta: number) {
  return clampScrollTo(view, view.getScrollOffset() + delta)
}

/**
 * Scrollable middle pane: finalized history + streaming partial + activity.
 *
 * Content is bottom-anchored (chat grows upward from the input). A dynamic
 * top spacer fills unused viewport rows when history is short, so you never
 * see a floating block at the top of an empty pane.
 *
 * Key ownership (chat vs text field):
 *   PageUp/Down, Ctrl+↑/↓, Ctrl+Home/End, mouse wheel → this viewport
 *   ↑/↓, ←/→, Home/End (no ctrl), Ctrl+←/→ → TextInput cursor
 *   Ctrl+T → mic, `/` at start → menu
 *
 * Stick-to-bottom uses a small slop so streaming near the end stays pinned.
 */
export function ChatViewport({
  events,
  thinking,
  partial,
  pending,
  bottomChromeKey
}: {
  events: TimelineEvent[]
  thinking: boolean
  partial: PartialMessageData | null
  pending: boolean
  /** Changes whenever the sibling below (input / confirm prompt) swaps to a
   * differently-sized layout, so the viewport remeasures even though none of
   * the other props changed. */
  bottomChromeKey?: string | number
}) {
  const scrollRef = useRef<VirtualScrollRef>(null)
  const stickRef = useRef(true)
  const topPadRef = useRef(0)
  const [stuckToBottom, setStuckToBottom] = useState(true)
  const [canScroll, setCanScroll] = useState(false)
  /** Extra rows above the messages so short history sits on the bottom edge. */
  const [topPad, setTopPad] = useState(0)
  const { columns, rows } = useWindowSize()
  const { stdout } = useStdout()

  useMouseTracking(true)

  const setStick = (next: boolean) => {
    stickRef.current = next
    setStuckToBottom(next)
  }

  const syncCanScroll = () => {
    const view = scrollRef.current
    if (!view) return
    setCanScroll(view.getBottomOffset() > 0)
  }

  /**
   * Keep messages bottom-aligned when they don't fill the viewport:
   * topPad = max(0, viewport - messageHeight), with messageHeight excluding
   * the spacer itself.
   */
  const syncTopPad = () => {
    const view = scrollRef.current
    if (!view) return
    const vh = view.getViewportHeight()
    if (vh <= 0) return
    const total = view.getContentHeight()
    const messagesH = Math.max(0, total - topPadRef.current)
    const next = Math.max(0, vh - messagesH)
    if (next !== topPadRef.current) {
      topPadRef.current = next
      setTopPad(next)
    }
  }

  const remeasure = () => {
    scrollRef.current?.remeasure()
    // After layout, recompute pad then remeasure again so the spacer height applies.
    setTimeout(() => {
      syncTopPad()
      scrollRef.current?.remeasure()
      syncCanScroll()
      if (stickRef.current) scrollRef.current?.scrollToBottom()
    }, 0)
  }

  const readAtBottom = () => {
    const view = scrollRef.current
    if (!view) return true
    return isAtBottom(
      view.getScrollOffset(),
      view.getBottomOffset(),
      STICK_SLOP
    )
  }

  const updateStickFromView = () => {
    setStick(readAtBottom())
    syncCanScroll()
  }

  // Parent layout / terminal resize: ScrollView needs an explicit remeasure
  // after width *and* height change (footer/header row budget shifts).
  useEffect(() => {
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
    syncTopPad()
    if (stickRef.current) {
      scrollRef.current?.scrollToBottom()
    }
    syncCanScroll()
  }

  // New messages / streaming tokens: keep the tail in view when pinned.
  useEffect(() => {
    // Let ScrollView measure new children, then pad + follow.
    const timer = setTimeout(followIfPinned, 0)
    return () => clearTimeout(timer)
  }, [events, partial, pending, thinking, topPad, bottomChromeKey])

  useInput((input, key) => {
    const view = scrollRef.current
    if (!view) return

    // Nothing to scroll: keep stick, don't create empty overscroll.
    const maxScroll = view.getBottomOffset()

    if (isTerminalMouseSequence(input)) {
      const wheel = parseWheelDirection(input)
      if (wheel === "up") {
        if (maxScroll <= 0) return
        setStick(false)
        scrollByClamped(view, -WHEEL_LINES)
        updateStickFromView()
      } else if (wheel === "down") {
        if (maxScroll <= 0) return
        scrollByClamped(view, WHEEL_LINES)
        updateStickFromView()
      }
      return
    }

    const page = Math.max(1, (view.getViewportHeight() || 10) - 1)

    if (key.pageUp) {
      if (maxScroll <= 0) return
      setStick(false)
      scrollByClamped(view, -page)
      updateStickFromView()
      return
    }
    if (key.pageDown) {
      if (maxScroll <= 0) return
      scrollByClamped(view, page)
      updateStickFromView()
      return
    }
    if (key.ctrl && key.upArrow) {
      if (maxScroll <= 0) return
      setStick(false)
      scrollByClamped(view, -3)
      updateStickFromView()
      return
    }
    if (key.ctrl && key.downArrow) {
      if (maxScroll <= 0) return
      scrollByClamped(view, 3)
      updateStickFromView()
      return
    }
    if (key.ctrl && key.home) {
      if (maxScroll <= 0) return
      setStick(false)
      clampScrollTo(view, 0)
      updateStickFromView()
      return
    }
    if (key.ctrl && key.end) {
      setStick(true)
      view.scrollToBottom()
      updateStickFromView()
    }
  })

  const showAffordance = canScroll && !stuckToBottom

  // Stable element identities across scroll-tick renders: TimelineItem is
  // memo()ed, and keeping the same elements here also stops the ScrollView's
  // per-item measurement effect (keyed on child identity) from re-running.
  const timelineItems = useMemo(
    () =>
      events.map((item, i) => (
        <Box key={`e-${i}`}>
          <TimelineItem item={item} thinking={thinking} />
        </Box>
      )),
    [events, thinking]
  )

  return (
    <Box
      flexGrow={1}
      flexShrink={1}
      flexBasis={0}
      minHeight={3}
      marginY={1}
      flexDirection="column"
      overflow="hidden"
      width="100%"
    >
      {showAffordance && (
        <Box flexShrink={0} width="100%">
          <Text dimColor>{t("viewport.older")}</Text>
        </Box>
      )}
      <VirtualScroll
        ref={scrollRef}
        flexGrow={1}
        flexShrink={1}
        width="100%"
        onScroll={() => {
          updateStickFromView()
        }}
        onContentHeightChange={() => {
          followIfPinned()
        }}
        onViewportSizeChange={() => {
          followIfPinned()
        }}
      >
        {/*
          Fills unused viewport rows so messages sit on the bottom edge
          (chat grows upward). Collapses to 0 once history exceeds the pane.
        */}
        {topPad > 0 ? (
          <Box key="top-pad" height={topPad} flexShrink={0} width="100%" />
        ) : null}
        {timelineItems}
        <Box key="partial">
          <PartialMessage partial={partial} thinking={thinking} />
        </Box>
        <Box key="activity">
          <Activity pending={pending} partial={partial} thinking={thinking} />
        </Box>
      </VirtualScroll>
    </Box>
  )
}
