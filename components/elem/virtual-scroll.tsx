import { Box, type DOMElement, measureElement } from "ink"
import {
  Children,
  isValidElement,
  memo,
  type ReactNode,
  type Ref,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useReducer,
  useRef
} from "react"

/**
 * Imperative surface of {@link VirtualScroll} — mirrors the subset of
 * ink-scroll-view's ScrollViewRef that ChatViewport uses, so swapping the
 * implementations doesn't ripple into the viewport logic.
 */
export type VirtualScrollRef = {
  scrollTo: (offset: number) => void
  scrollToBottom: () => void
  getScrollOffset: () => number
  getContentHeight: () => number
  getViewportHeight: () => number
  getBottomOffset: () => number
  remeasure: () => void
}

/**
 * Measures its child once laid out and reports the height. Memoized so a
 * scroll tick (which re-renders VirtualScroll) doesn't re-render or
 * re-measure items whose element identity hasn't changed — only new
 * children (fresh elements, e.g. the streaming partial) or an epoch bump
 * (width change invalidating all heights) re-run the measurement.
 */
const MeasuredItem = memo(function MeasuredItem({
  id,
  epoch,
  onMeasure,
  children
}: {
  id: string
  /** Bumped when all cached heights are invalidated (e.g. width change). */
  epoch: number
  onMeasure: (id: string, height: number) => void
  children: ReactNode
}) {
  const ref = useRef<DOMElement>(null)
  useLayoutEffect(() => {
    if (ref.current) onMeasure(id, measureElement(ref.current).height)
  })
  // epoch is a dependency via the render itself: a new epoch re-renders this
  // component (prop change), which re-runs the measuring effect above.
  void epoch
  return (
    <Box ref={ref} flexDirection="column" flexShrink={0} width="100%">
      {children}
    </Box>
  )
})

/**
 * A windowed replacement for ink-scroll-view's ScrollView: only the
 * children intersecting the viewport are mounted, so scroll ticks and
 * streaming re-renders cost O(viewport), not O(history). ink-scroll-view
 * keeps every child mounted, which made Ink re-layout and re-render the
 * whole conversation on every frame — the "frozen on long conversations"
 * bug.
 *
 * How it works: every child is measured once (via {@link MeasuredItem})
 * when it first mounts; heights are cached by child key. While any height
 * is unknown (initial mount, width change) all children render — one
 * expensive pass. Once all heights are known, only the visible slice
 * mounts, vertically shifted by a negative margin for sub-item scroll
 * positions, inside an overflow-hidden container.
 */
export function VirtualScroll({
  ref,
  children,
  onScroll,
  onContentHeightChange,
  onViewportSizeChange,
  flexGrow,
  flexShrink,
  width
}: {
  ref: Ref<VirtualScrollRef>
  children: ReactNode
  onScroll?: (offset: number) => void
  onContentHeightChange?: (height: number) => void
  onViewportSizeChange?: (height: number) => void
  flexGrow?: number
  flexShrink?: number
  width?: number | string
}) {
  const [, force] = useReducer((x: number) => x + 1, 0)
  const containerRef = useRef<DOMElement>(null)
  const offsetRef = useRef(0)
  const viewportRef = useRef(0)
  const widthRef = useRef(0)
  const heightsRef = useRef(new Map<string, number>())
  const epochRef = useRef(0)

  const items = Children.toArray(children)
  const keys = items.map((item, i) =>
    isValidElement(item) && item.key != null ? String(item.key) : `i-${i}`
  )
  const heights = keys.map((key) => heightsRef.current.get(key))
  const allMeasured = heights.every((h) => h !== undefined)

  const contentHeight = () => {
    let sum = 0
    for (const h of heightsRef.current.values()) sum += h
    return sum
  }
  const bottomOffset = () => Math.max(0, contentHeight() - viewportRef.current)

  const scrollTo = (offset: number) => {
    const next = Math.max(0, Math.min(offset, bottomOffset()))
    if (next === offsetRef.current) return
    offsetRef.current = next
    onScroll?.(next)
    force()
  }

  useImperativeHandle(ref, () => ({
    scrollTo,
    scrollToBottom: () => scrollTo(Number.POSITIVE_INFINITY),
    getScrollOffset: () => offsetRef.current,
    getContentHeight: contentHeight,
    getViewportHeight: () => viewportRef.current,
    getBottomOffset: bottomOffset,
    remeasure: () => force()
  }))

  const handleMeasure = useCallback(
    (id: string, height: number) => {
      if (heightsRef.current.get(id) === height) return
      heightsRef.current.set(id, height)
      onContentHeightChange?.(contentHeight())
      force()
    },
    [onContentHeightChange]
  )

  // Track viewport size and width after every render. Width changes rewrap
  // every item's text, so all cached heights become wrong — drop them and
  // let the next render do a full measuring pass.
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const { width: w, height } = measureElement(el)
    if (height > 0 && height !== viewportRef.current) {
      viewportRef.current = height
      onViewportSizeChange?.(height)
      force()
    }
    if (w > 0 && w !== widthRef.current) {
      if (widthRef.current > 0) {
        heightsRef.current.clear()
        epochRef.current += 1
      }
      widthRef.current = w
      force()
    }
  })

  // Drop cached heights for children that no longer exist (persona switch
  // clears the timeline), so stale entries don't inflate contentHeight.
  const liveKeys = new Set(keys)
  for (const key of heightsRef.current.keys()) {
    if (!liveKeys.has(key)) heightsRef.current.delete(key)
  }

  const offset = offsetRef.current
  let start = 0
  let innerMargin = -offset
  let mounted = items
  if (allMeasured && viewportRef.current > 0) {
    let acc = 0
    while (start < items.length && acc + heights[start]! <= offset) {
      acc += heights[start]!
      start++
    }
    let end = start
    let covered = 0
    const needed = offset - acc + viewportRef.current
    while (end < items.length && covered < needed) {
      covered += heights[end]!
      end++
    }
    mounted = items.slice(start, end)
    innerMargin = -(offset - acc)
  }

  return (
    <Box
      ref={containerRef}
      flexDirection="column"
      overflow="hidden"
      flexGrow={flexGrow}
      flexShrink={flexShrink}
      width={width}
    >
      <Box
        flexDirection="column"
        flexShrink={0}
        width="100%"
        marginTop={innerMargin}
      >
        {mounted.map((item, i) => (
          <MeasuredItem
            key={keys[start + i]!}
            id={keys[start + i]!}
            epoch={epochRef.current}
            onMeasure={handleMeasure}
          >
            {item}
          </MeasuredItem>
        ))}
      </Box>
    </Box>
  )
}
