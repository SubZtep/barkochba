// Static i18n: both dictionaries load at import, the active language is set
// once at startup (cli.tsx, from settings.language). No live switching — a
// language change takes effect on the next launch.

import * as z from "zod"
import en from "../locales/en.toml"
import hu from "../locales/hu.toml"

export type Language = "en" | "hu"

function flatten(
  table: Record<string, unknown>,
  prefix = "",
  out = new Map<string, string>()
) {
  for (const [key, value] of Object.entries(table)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === "string") out.set(path, value)
    else if (value && typeof value === "object")
      flatten(value as Record<string, unknown>, path, out)
  }
  return out
}

// Exported for the key-parity test.
export const dictionaries: Record<Language, Map<string, string>> = {
  en: flatten(en),
  hu: flatten(hu)
}

let language: Language = "en"

export function getLanguage() {
  return language
}

/** System locale → supported language: hu for a Hungarian locale, else en. */
export function detectLanguage(): Language {
  const locale =
    process.env.LC_ALL ||
    process.env.LC_MESSAGES ||
    process.env.LANG ||
    Intl.DateTimeFormat().resolvedOptions().locale
  return locale.toLowerCase().startsWith("hu") ? "hu" : "en"
}

export function setLanguage(next: Language) {
  language = next
  // Zod validation messages (wizard field errors) follow along.
  z.config(z.locales[next]())
}

/** Dictionary lookup with `{param}` interpolation; falls back hu → en → key. */
export function t(key: string, params?: Record<string, string | number>) {
  const template =
    dictionaries[language].get(key) ?? dictionaries.en.get(key) ?? key
  return params
    ? template.replace(/\{(\w+)\}/g, (match, name) =>
        name in params ? String(params[name]) : match
      )
    : template
}
