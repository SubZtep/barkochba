import dedent from "dedent"
import meow from "meow"
import { writeText } from "tinyclip"
import { configPath } from "./config"

// Injected at compile time by CI via `bun build --define CLI_VERSION=...`
// with the package.json version; undefined when running from source, where
// meow reads package.json itself.
declare const CLI_VERSION: string | undefined

export const cli = meow(
  dedent`
  Usage
    $ kaja

  Options
    --help     Print this help
    --name     Your name, shown in the greeting
    --config   Print the config file location and copy it to the clipboard
    --version  Print the installed app version

  Examples
    $ kaja --name=Lili
    Hello, Lili

    $ kaja --config
    /home/dcr/.config/kaja/config.json
`,
  {
    importMeta: import.meta,
    ...(typeof CLI_VERSION === "string" ? { version: CLI_VERSION } : {}),
    flags: {
      name: {
        type: "string"
      },
      config: {
        type: "boolean"
      }
    }
  }
)

if (cli.flags.config) {
  console.log(configPath)
  try {
    await writeText(configPath)
  } catch (error: any) {
    console.error(error?.message ?? "Clipboard tool failed")
  }
  process.exit(0)
}
