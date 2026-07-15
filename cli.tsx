import { render } from "ink"
import meow from "meow"
import App from "./components/app"
import { lookupMyLocation } from "./lib/geo"

const cli = meow(
  `
  Usage
    $ kaja

  Options
    --name  Your name

  Examples
    $ kaja --name=Lili
    Hello, Lili
`,
  {
    importMeta: import.meta,
    flags: {
      name: {
        type: "string"
      }
    }
  }
)

const location = await lookupMyLocation().catch((error) => {
  console.warn(`Geo lookup failed: ${error.message}`)
  return null
})
if (location)
  console.log(
    `📍 ${location.city.name}, ${location.country.name} (${location.location.timeZone})`
  )

render(<App name={cli.flags.name} />)
const { waitUntilExit } = render(<App name={cli.flags.name} />)
await waitUntilExit()

console.log("Bye, bye!")
