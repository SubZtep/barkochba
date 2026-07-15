import { color } from "bun"
import dedent from "dedent"
import { render } from "ink"
import meow from "meow"
import { config, configPath, create, isExists, validate } from "./lib/config"
import { lookupMyLocation } from "./lib/geo"
import { loadModels } from "./lib/models"

if (!(await isExists())) {
  await create()
  console.log(`${color("red", "ansi")}Config file created. Please populate:`)
  console.log(`${color("yellow", "ansi")}${configPath}`)
  process.exit(0)
} else if (!(await validate())) {
  console.log(`${color("red", "ansi")}Invalid config file: ${configPath}`)
  process.exit(1)
}

// Imported after the config guard: lib/openai.ts reads the config at module
// load, so a static import would crash before the first-run flow above.
const { default: App } = await import("./components/app")

// Injected at compile time by CI via `bun build --define CLI_VERSION=...`
// with the package.json version; undefined when running from source, where
// meow reads package.json itself.
declare const CLI_VERSION: string | undefined

const cli = meow(
  dedent`
  Usage
    $ kaja

  Options
    --help     Print this help
    --name     Your name, shown in the greeting
    --config   Print config file location
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
  process.exit(0)
}

const location = await lookupMyLocation().catch((error) => {
  console.warn(`Geo lookup failed: ${error.message}`)
  return null
})
if (location) console.log(`     📍${location.country.name}`)

const { settings } = await config()
const models = await loadModels()
const { waitUntilExit } = render(
  <App name={cli.flags.name} initialSettings={settings} models={models} />
)
await waitUntilExit()

console.log("Bye, bye!")
process.exit(0)
