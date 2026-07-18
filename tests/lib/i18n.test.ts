import { afterEach, expect, test } from "bun:test"
import { detectLanguage, dictionaries, setLanguage, t } from "../../lib/i18n"

afterEach(() => setLanguage("en"))

test("en and hu dictionaries have the same keys", () => {
  expect([...dictionaries.hu.keys()].sort()).toEqual(
    [...dictionaries.en.keys()].sort()
  )
})

test("interpolates params", () => {
  expect(t("cli.invalidConfig", { path: "/x/config.json" })).toBe(
    "Invalid config file: /x/config.json"
  )
})

test("leaves unknown placeholders alone", () => {
  expect(t("cli.invalidConfig", { nope: 1 })).toBe(
    "Invalid config file: {path}"
  )
})

test("unknown key falls back to the key itself", () => {
  expect(t("no.such.key")).toBe("no.such.key")
})

test("setLanguage switches the dictionary", () => {
  expect(t("wizard.review")).toBe("Review")
  setLanguage("hu")
  expect(t("wizard.review")).toBe("Áttekintés")
})

test("detectLanguage maps Hungarian locales to hu, others to en", () => {
  const saved = { ...process.env }
  try {
    process.env.LC_ALL = "hu_HU.UTF-8"
    expect(detectLanguage()).toBe("hu")
    process.env.LC_ALL = "en_GB.UTF-8"
    expect(detectLanguage()).toBe("en")
    delete process.env.LC_ALL
    delete process.env.LC_MESSAGES
    process.env.LANG = "hu_HU"
    expect(detectLanguage()).toBe("hu")
  } finally {
    for (const key of ["LC_ALL", "LC_MESSAGES", "LANG"] as const) {
      const value = saved[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
