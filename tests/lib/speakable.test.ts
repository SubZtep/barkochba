import { expect, test } from "bun:test"
import { toSpeakable } from "../../lib/speakable"

test("strips emphasis, links, and inline code", () => {
  expect(toSpeakable("**No**, it's _not_ a `pet`.")).toBe("No, it's not a pet.")
  expect(toSpeakable("See [the docs](https://example.com) for more.")).toBe(
    "See the docs for more."
  )
  expect(toSpeakable("Look at https://example.com/x?q=1 now")).toBe(
    "Look at now"
  )
})

test("drops code blocks, list markers, headings, and emoji", () => {
  expect(toSpeakable("# Result\n- one\n- two\n> quoted")).toBe(
    "Result one two quoted"
  )
  expect(toSpeakable("Run this:\n```sh\nrm -rf /\n```\nDone.")).toBe(
    "Run this: Done."
  )
  expect(toSpeakable("You got it in 9 questions 🎉 — well done! 😄")).toBe(
    "You got it in 9 questions — well done!"
  )
})

test("plain sentences pass through untouched", () => {
  expect(toSpeakable("Question 4: is it alive?")).toBe(
    "Question 4: is it alive?"
  )
  expect(toSpeakable("")).toBe("")
})
