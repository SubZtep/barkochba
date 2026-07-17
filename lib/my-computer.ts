import { join } from "node:path"

const soundFile = {
  bell: "333695__khrinx__thin-bell-ding-2.wav",
  magic: "628548__gmlh__icemagic.mp3",
  wind: "817959__jriches1__whoosh-away.mp3",
  hehe: "818171__sadiquecat__sadiquecat-mke600-laughing-nervous-laugh-hehe.wav",
  error: "662346__fmaudio__interface-error-7.wav"
} as const

export function playSound(sound: keyof typeof soundFile) {
  Bun.spawn([
    "pw-play",
    join(import.meta.dirname, "..", "assets", soundFile[sound])
  ])
}
