import meow from "meow"
import { writeText } from "tinyclip"
import { getConfigPath } from "./config"
import { t } from "./i18n"

// Injected at compile time by CI via `bun build --define CLI_VERSION=...`
// with the package.json version; undefined when running from source, where
// meow reads package.json itself.
declare const CLI_VERSION: string | undefined

export const cli = meow(t("args.help"), {
  importMeta: import.meta,
  ...(typeof CLI_VERSION === "string" ? { version: CLI_VERSION } : {}),
  flags: {
    config: {
      type: "boolean"
    },
    wizard: {
      type: "boolean"
    },
    continue: {
      type: "boolean",
      shortFlag: "c"
    },
    session: {
      type: "string",
      shortFlag: "s"
    }
  }
})

if (cli.flags.config) {
  const configPath = getConfigPath()
  console.log(configPath)
  try {
    await writeText(configPath)
  } catch (error: any) {
    console.error(error?.message ?? t("args.clipboardFailed"))
  }
  process.exit(0)
}
