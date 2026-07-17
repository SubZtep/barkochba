import { Text, type TextProps, Transform } from "ink"
import type React from "react"
import terminalLink from "terminal-link"

export default function Link({
  href,
  children,
  ...textProps
}: {
  /** URL to link to. */
  href: string
} & TextProps & { children?: React.ReactNode }) {
  return (
    <Transform transform={(c: any) => terminalLink(String(c), href)}>
      <Text {...textProps}>{children}</Text>
    </Transform>
  )
}
