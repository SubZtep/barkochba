import { color } from "bun"
import dedent from "dedent"
import { render } from "ink"
import meow from "meow"
import App from "./components/app"
import { configPath, create, isExists, validate } from "./lib/config"
import { lookupMyLocation } from "./lib/geo"

if (!(await isExists())) {
  await create()
  console.log(`${color("red", "ansi")}Config file created. Please populate:`)
  console.log(`${color("yellow", "ansi")}${configPath}`)
  process.exit(0)
} else if (!(await validate())) {
  console.log(`${color("red", "ansi")}Invalid config file: ${configPath}`)
  process.exit(1)
}

const cli = meow(
  dedent`
  Usage
    $ kaja

  Options
    --name     Your name
    --config   Print config file location

  Examples
    $ kaja --name=Lili
    Hello, Lili

    $ kaja --config
    /home/dcr/.config/kaja/config.json
`,
  {
    importMeta: import.meta,
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
if (location)
  console.log(
    `📍 ${location.city.name}, ${location.country.name} (${location.location.timeZone})`
  )

const { waitUntilExit } = render(<App name={cli.flags.name} />)
await waitUntilExit()

console.log("Bye, bye!")
