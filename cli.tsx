import { render } from "ink"
import meow from "meow"
import App from "./components/app"

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

render(<App name={cli.flags.name} />)
