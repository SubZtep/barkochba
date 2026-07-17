import { expect, test } from "bun:test"
import {
  isIgnoredTerminalInput,
  isKittyKeyboardNoise,
  isTerminalMouseSequence,
  parseWheelDirection
} from "../../lib/terminal-input"

test("detects SGR mouse sequences (ESC stripped as useInput sees them)", () => {
  expect(isTerminalMouseSequence("[<64;10;5M]")).toBe(false)
  expect(isTerminalMouseSequence("[<64;10;5M")).toBe(true)
  expect(isTerminalMouseSequence("[<65;1;1m")).toBe(true)
  expect(isTerminalMouseSequence("[<0;10;5M")).toBe(true)
  expect(isTerminalMouseSequence("hello")).toBe(false)
  expect(isTerminalMouseSequence("")).toBe(false)
})

test("parses wheel up/down from SGR button codes", () => {
  expect(parseWheelDirection("[<64;10;5M")).toBe("up")
  expect(parseWheelDirection("[<65;10;5M")).toBe("down")
  expect(parseWheelDirection("[<0;10;5M")).toBe(null)
  expect(parseWheelDirection("t")).toBe(null)
})

test("kitty keyboard replies are noise (not typed into the prompt)", () => {
  // What the user saw prefilled: terminal reply after protocol query/enable
  expect(isKittyKeyboardNoise("[?0u")).toBe(true)
  expect(isKittyKeyboardNoise("[?1u")).toBe(true)
  expect(isKittyKeyboardNoise("[>1u")).toBe(true)
  expect(isIgnoredTerminalInput("[?0u")).toBe(true)
  expect(isIgnoredTerminalInput("hello")).toBe(false)
  expect(isIgnoredTerminalInput("/")).toBe(false)
})
