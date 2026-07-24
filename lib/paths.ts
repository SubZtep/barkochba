import envPaths from "env-paths"

// Computed fresh on every call rather than as a module-level constant: tests
// run many spec files in one process and mutate XDG_*_HOME/NODE_ENV per file,
// so a frozen constant would lock in whichever env happened to be set when
// this module first loaded, for the rest of the process.
export function getPaths() {
  return envPaths("kaja", {
    suffix: process.env.NODE_ENV === "development" ? "dev" : ""
  })
}
