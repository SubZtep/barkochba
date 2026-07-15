import { expect, test } from "bun:test"
import { useState } from "react"
import { UserInput } from "../../components/user-input"
import { renderForTest } from "../test-utils"

test("slash menu: open, navigate, select, dismiss", async () => {
  const selections: number[] = []
  const t = renderForTest(
    <UserInput
      pending={false}
      send={async () => {}}
      menuItems={["Toggle thinking [on]", "Toggle sounds [on]", "Change model"]}
      onMenuSelect={(index) => {
        selections.push(index)
      }}
    />
  )
  await t.tick()

  // "/" as first character opens the menu
  await t.press("/")
  expect(t.lastFrame()).toContain("Toggle thinking")

  // down arrow moves the selection
  await t.press("\x1b[B")
  expect(t.lastFrame()).toContain("> Toggle sounds")

  // return fires onMenuSelect with the highlighted index and closes the menu
  await t.press("\r")
  expect(selections).toEqual([1])
  expect(t.lastFrame()).not.toContain("Toggle thinking")

  // reopening starts from the first item again
  await t.press("/")
  expect(t.lastFrame()).toContain("> Toggle thinking")

  // escape dismisses without selecting
  await t.press("\x1b")
  expect(selections).toEqual([1])
  expect(t.lastFrame()).not.toContain("Toggle thinking")

  // plain typing still works, and a "/" mid-text does not open the menu
  await t.press("hello")
  expect(t.lastFrame()).toContain("hello")
  await t.press("/")
  expect(t.lastFrame()).not.toContain("Toggle thinking")

  t.unmount()
  await t.waitUntilExit()
})

/**
 * Mimics App's submenu contract: selecting "Change model" swaps menuItems
 * and returns true to keep the menu open; selecting a model closes it;
 * onMenuClose resets to the main menu.
 */
function SubmenuHarness({ log }: { log: string[] }) {
  const [mode, setMode] = useState<"main" | "model">("main")
  const items =
    mode === "main"
      ? ["Toggle thinking [on]", "Change model"]
      : ["DeepSeek fast", "Kimi big"]
  return (
    <UserInput
      pending={false}
      send={async () => {}}
      menuItems={items}
      onMenuSelect={(index) => {
        if (mode === "main" && index === 1) {
          setMode("model")
          return true
        }
        log.push(`${mode}:${index}`)
      }}
      onMenuClose={() => {
        log.push("close")
        setMode("main")
      }}
    />
  )
}

test("submenu: keep-open swaps items, selection resets, close reported", async () => {
  const log: string[] = []
  const t = renderForTest(<SubmenuHarness log={log} />)
  await t.tick()

  // open the menu and move to "Change model"
  await t.press("/")
  await t.press("\x1b[B")
  expect(t.lastFrame()).toContain("> Change model")

  // selecting it keeps the menu open with the swapped items, selection reset
  await t.press("\r")
  expect(t.lastFrame()).toContain("> DeepSeek fast")
  expect(t.lastFrame()).not.toContain("Change model")
  expect(log).toEqual([])

  // picking a model reports it and closes the menu
  await t.press("\x1b[B")
  await t.press("\r")
  expect(log).toEqual(["model:1", "close"])
  expect(t.lastFrame()).not.toContain("Kimi big")

  // reopening starts back at the main menu
  await t.press("/")
  expect(t.lastFrame()).toContain("> Toggle thinking")

  // escape from the menu also reports the close
  await t.press("\x1b")
  expect(log).toEqual(["model:1", "close", "close"])
  expect(t.lastFrame()).not.toContain("Toggle thinking")

  t.unmount()
  await t.waitUntilExit()
})
