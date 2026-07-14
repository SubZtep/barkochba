// PCM16 resamplers between Discord's wire format (48kHz stereo) and the
// pipeline's canonical format (24kHz mono). The ratio is exactly 2:1 so no
// interpolation is needed; quality is plenty for speech (whisper downsamples
// to 16kHz anyway).

/**
 * 48kHz stereo s16le → 24kHz mono: average L/R of two adjacent frames
 * (2-tap boxcar as crude anti-alias). Expects whole 8-byte frame pairs —
 * opus decoder output is whole packets, so no carry is needed.
 */
export function downTo24kMono(pcm: Buffer): Uint8Array {
  const out = new Int16Array(pcm.length >> 3)
  for (let i = 0; i < out.length; i++) {
    const o = i << 3
    out[i] =
      (pcm.readInt16LE(o) +
        pcm.readInt16LE(o + 2) +
        pcm.readInt16LE(o + 4) +
        pcm.readInt16LE(o + 6)) >>
      2
  }
  return new Uint8Array(out.buffer)
}

/**
 * 24kHz mono → 48kHz stereo: each sample written twice per channel (×4 bytes).
 * Stateful: TTS chunks are arbitrary-length, so a 16-bit sample can split
 * across chunks — a 1-byte carry stitches it back together.
 */
export function makeUpsampler(): (chunk: Uint8Array) => Buffer {
  let carry: number | undefined
  return (chunk) => {
    let pcm = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    if (carry !== undefined) {
      pcm = Buffer.concat([Buffer.from([carry]), pcm])
      carry = undefined
    }
    if (pcm.length % 2 === 1) {
      carry = pcm[pcm.length - 1]
      pcm = pcm.subarray(0, -1)
    }
    const samples = pcm.length >> 1
    const out = Buffer.alloc(samples * 8)
    for (let i = 0; i < samples; i++) {
      const s = pcm.readInt16LE(i << 1)
      const o = i << 3
      out.writeInt16LE(s, o) // L
      out.writeInt16LE(s, o + 2) // R
      out.writeInt16LE(s, o + 4) // L
      out.writeInt16LE(s, o + 6) // R
    }
    return out
  }
}
