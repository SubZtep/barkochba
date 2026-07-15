import { describe, expect, test } from "bun:test"
import { downTo24kMono, makeUpsampler } from "../../../lib/frontends/resample"

function frames48kStereo(samples: number[][]): Buffer {
  // samples: array of [L, R] pairs at 48kHz
  const buf = Buffer.alloc(samples.length * 4)
  samples.forEach(([l, r], i) => {
    buf.writeInt16LE(l ?? 0, i * 4)
    buf.writeInt16LE(r ?? 0, i * 4 + 2)
  })
  return buf
}

describe("downTo24kMono", () => {
  test("halves the frame count and drops to one channel", () => {
    const input = frames48kStereo(
      Array.from(
        {
          length: 960
        },
        () => [0, 0]
      )
    )
    expect(downTo24kMono(input).byteLength).toBe(960)
  })

  test("preserves DC level", () => {
    const input = frames48kStereo(
      Array.from(
        {
          length: 4
        },
        () => [1000, 1000]
      )
    )
    const out = new Int16Array(downTo24kMono(input).buffer)
    expect([...out]).toEqual([1000, 1000])
  })

  test("averages channels and adjacent frames", () => {
    const input = frames48kStereo([
      [100, 200],
      [300, 400]
    ])
    const out = new Int16Array(downTo24kMono(input).buffer)
    expect(out[0]).toBe(250)
  })

  test("handles negative samples", () => {
    const input = frames48kStereo([
      [-100, -200],
      [-300, -400]
    ])
    const out = new Int16Array(downTo24kMono(input).buffer)
    expect(out[0]).toBe(-250)
  })
})

describe("makeUpsampler", () => {
  test("quadruples byte length and duplicates each sample to L,R,L,R", () => {
    const up = makeUpsampler()
    const mono = Buffer.alloc(4)
    mono.writeInt16LE(123, 0)
    mono.writeInt16LE(-456, 2)
    const out = up(mono)
    expect(out.length).toBe(16)
    const s = Array.from({ length: 8 }, (_, i) => out.readInt16LE(i * 2))
    expect(s).toEqual([123, 123, 123, 123, -456, -456, -456, -456])
  })

  test("stitches a sample split across chunks", () => {
    const up = makeUpsampler()
    const mono = Buffer.alloc(4)
    mono.writeInt16LE(123, 0)
    mono.writeInt16LE(-456, 2)
    const out = Buffer.concat([up(mono.subarray(0, 3)), up(mono.subarray(3))])
    const s = Array.from({ length: 8 }, (_, i) => out.readInt16LE(i * 2))
    expect(s).toEqual([123, 123, 123, 123, -456, -456, -456, -456])
  })

  test("round-trips through downTo24kMono", () => {
    const up = makeUpsampler()
    const mono = Buffer.alloc(8)
    for (let i = 0; i < 4; i++) mono.writeInt16LE((i + 1) * 100, i * 2)
    const back = new Int16Array(downTo24kMono(up(mono)).buffer)
    expect([...back]).toEqual([100, 200, 300, 400])
  })
})
