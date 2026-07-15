import { expect, test } from "bun:test"
import { UserInput } from "../../components/user-input"
import { renderForTest } from "../test-utils"

test("slash menu: open, navigate, select, dismiss", async () => {
  const selections: number[] = []
  const t = renderForTest(
    <UserInput
      pending={false}
      send={async () => {}}
      menuItems={["Toggle thinking [on]", "Toggle sounds [on]", "Change model"]}
      onMenuSelect={(index) => selections.push(index)}
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
