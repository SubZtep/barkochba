import magic from "../assets/628548__gmlh__icemagic.mp3" with { type: "file" }
import bell from "../assets/333695__khrinx__thin-bell-ding-2.wav" with {
  type: "file"
}
import error from "../assets/662346__fmaudio__interface-error-7.wav" with {
  type: "file"
}
import wind from "../assets/817959__jriches1__whoosh-away.mp3" with {
  type: "file"
}
import hehe from "../assets/818171__sadiquecat__sadiquecat-mke600-laughing-nervous-laugh-hehe.wav" with {
  type: "file"
}

const soundFile = { bell, magic, wind, hehe, error } as const

export async function playSound(sound: keyof typeof soundFile) {
  const path = soundFile[sound]
  const format = path.endsWith(".mp3") ? "mp3" : "wav"

  const player = Bun.spawn(
    [
      "ffplay",
      "-loglevel",
      "quiet",
      "-nodisp",
      "-autoexit",
      "-f",
      format,
      "-i",
      "pipe:0"
    ],
    { stdin: "pipe" }
  )

  for await (const chunk of Bun.file(path).stream()) {
    player.stdin.write(chunk)
  }

  await player.stdin.end()
  await player.exited
}
