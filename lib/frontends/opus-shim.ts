// @discordjs/opus ships prebuilt NAPI binaries named by Node ABI, e.g.
// `node-v147-napi-v3-linux-x64-glibc-2.43`. Its loader (@discordjs/node-pre-gyp)
// derives the directory from `node-v${process.versions.modules}`, but Bun
// reports a different `process.versions.modules` (137 as of Bun 1.3.14) than the
// Node the binary was built for (147), so the loader looks for a dir that isn't
// there and prism-media falls through to missing node-opus/opusscript.
//
// The binary is NAPI v3 — ABI-stable across runtimes — so the existing file
// loads fine; only its directory label differs. Symlink the name Bun asks for
// to the one that exists. Idempotent, and self-heals after a reinstall since it
// runs on every startup.

import { existsSync, readdirSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { log } from "../logger"

export function ensureOpusPrebuild(): void {
  try {
    const root = join(
      process.cwd(),
      "node_modules",
      "@discordjs",
      "opus",
      "prebuild"
    )
    if (!existsSync(root)) return // opus not installed / different layout — let the loader error naturally

    const dirs = readdirSync(root)
    const existing = dirs.find((d) => d.includes("-napi-v"))
    if (!existing) return

    const suffix = existing.slice(existing.indexOf("-napi"))
    const wanted = `node-v${process.versions.modules}${suffix}`
    if (wanted === existing || dirs.includes(wanted)) return

    symlinkSync(existing, join(root, wanted), "dir")
    log.debug(
      {
        from: wanted,
        to: existing
      },
      "discord: linked opus prebuild for Bun ABI"
    )
  } catch (err) {
    log.warn(err, "discord: could not shim @discordjs/opus prebuild path")
  }
}
