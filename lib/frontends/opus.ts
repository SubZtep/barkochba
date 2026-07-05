// Opus codec for the Discord frontend, using @discordjs/opus directly.
//
// We deliberately bypass prism-media's opus streams: under Bun, prism's loader
// (require('@discordjs/opus') from prism's own file location) fails to resolve
// the package, so both prism.opus.Decoder (receive) and prism.opus.Encoder
// (the StreamType.Raw send path) throw. Requiring @discordjs/opus from *this*
// module resolves fine, so we own the codec and feed @discordjs/voice ready-made
// Opus frames (StreamType.Opus), keeping prism out of the hot loop entirely.
//
// ensureOpusPrebuild() must run before this module is imported (the native
// binary's prebuild dir is ABI-named for Node, not Bun — see opus-shim.ts).

import { Transform, type TransformCallback } from "node:stream"

export const OPUS_RATE = 48000
export const OPUS_CHANNELS = 2
export const OPUS_FRAME_SAMPLES = 960 // 20ms @ 48kHz
// bytes in one full stereo s16le frame the encoder expects
export const OPUS_FRAME_BYTES = OPUS_FRAME_SAMPLES * OPUS_CHANNELS * 2

// Loaded lazily on first use so ensureOpusPrebuild() (which fixes the native
// binary's ABI-named prebuild path under Bun) can run first.
// biome-ignore lint/suspicious/noExplicitAny: @discordjs/opus has no bundled types
let OpusEncoder: any
function loadEncoder() {
	if (!OpusEncoder) OpusEncoder = require("@discordjs/opus").OpusEncoder
	return OpusEncoder
}

export interface OpusCodec {
	encode(pcm: Buffer): Buffer
	decode(packet: Buffer): Buffer
}

export function createOpusCodec(): OpusCodec {
	return new (loadEncoder())(OPUS_RATE, OPUS_CHANNELS)
}

/**
 * s16le 48kHz stereo PCM -> stream of Opus packets (StreamType.Opus).
 * Buffers to exact 20ms frames; the encoder rejects partial frames. Any tail
 * shorter than a frame at stream end is zero-padded so it still gets spoken.
 */
export class PcmToOpus extends Transform {
	private codec = createOpusCodec()
	private carry: Buffer = Buffer.alloc(0)

	constructor() {
		super({ readableObjectMode: false })
	}

	override _transform(
		chunk: Buffer,
		_enc: BufferEncoding,
		cb: TransformCallback
	) {
		const buf = this.carry.length ? Buffer.concat([this.carry, chunk]) : chunk
		let offset = 0
		while (buf.length - offset >= OPUS_FRAME_BYTES) {
			const frame = buf.subarray(offset, offset + OPUS_FRAME_BYTES)
			offset += OPUS_FRAME_BYTES
			try {
				this.push(this.codec.encode(frame))
			} catch (err) {
				return cb(err as Error)
			}
		}
		this.carry = buf.subarray(offset)
		cb()
	}

	override _flush(cb: TransformCallback) {
		if (this.carry.length) {
			const frame = Buffer.alloc(OPUS_FRAME_BYTES)
			this.carry.copy(frame)
			try {
				this.push(this.codec.encode(frame))
			} catch (err) {
				return cb(err as Error)
			}
		}
		cb()
	}
}
