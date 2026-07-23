import { expect, test } from "bun:test"
import { isDangerousCommand } from "../../lib/command-risk"

test("flags rm -rf as dangerous", () => {
  expect(isDangerousCommand("rm -rf /tmp/build")).toBe(true)
  expect(isDangerousCommand("rm -fr node_modules")).toBe(true)
})

test("flags a force push as dangerous", () => {
  expect(isDangerousCommand("git push --force origin main")).toBe(true)
  expect(isDangerousCommand("git push -f origin main")).toBe(true)
})

test("flags sudo as dangerous", () => {
  expect(isDangerousCommand("sudo apt install ffmpeg")).toBe(true)
})

test("flags git reset --hard as dangerous", () => {
  expect(isDangerousCommand("git reset --hard HEAD~1")).toBe(true)
})

test("does not flag an ordinary command", () => {
  expect(isDangerousCommand("ls -la")).toBe(false)
  expect(isDangerousCommand("git status")).toBe(false)
  expect(isDangerousCommand("rm build.log")).toBe(false)
  expect(isDangerousCommand("git push origin main")).toBe(false)
})
