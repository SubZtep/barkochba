// Discord audio frontend: the bot joins a voice channel and acts as the
// microphone and speaker. It listens to one configured user (DISCORD_USER_ID)
// and plays synthesized speech into the channel.
//
// Discord's wire format is 48kHz stereo Opus both directions; this adapts it
// to the pipeline's canonical pcm16 mono 24kHz (see lib/frontends/resample.ts).

import { PassThrough } from "node:stream"
import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  EndBehaviorType,
  entersState,
  joinVoiceChannel,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus
} from "@discordjs/voice"
import { Client, Events, GatewayIntentBits } from "discord.js"
import type { AudioFrontend, AudioSink, AudioSource } from "../audio"
import { createAsyncQueue, SAMPLE_RATE } from "../audio"
import { log } from "../logger"
import { createOpusCodec, PcmToOpus } from "./opus"
import { ensureOpusPrebuild } from "./opus-shim"
import { downTo24kMono, makeUpsampler } from "./resample"

const TOKEN = process.env.DISCORD_TOKEN
const GUILD_ID = process.env.DISCORD_GUILD_ID
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID
const USER_ID = process.env.DISCORD_USER_ID

export async function createDiscordFrontend(): Promise<AudioFrontend> {
  if (!TOKEN || !GUILD_ID || !CHANNEL_ID || !USER_ID)
    throw new Error(
      "missing env: DISCORD_TOKEN, DISCORD_GUILD_ID, DISCORD_CHANNEL_ID, DISCORD_USER_ID"
    )

  // Fix @discordjs/opus's prebuild path lookup under Bun before any decoder is
  // constructed (see opus-shim.ts).
  ensureOpusPrebuild()

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
  })
  await client.login(TOKEN)
  // Wait for the gateway to deliver GUILD_CREATE before joining: the voice
  // adapter relies on cached gateway state, and fetching the guild over REST
  // before it exists races the handshake into a silent 4017-free stall.
  await new Promise<void>((resolve) =>
    client.once(Events.ClientReady, () => resolve())
  )
  log.info({ user: client.user?.tag }, "discord: logged in")

  const guild = client.guilds.cache.get(GUILD_ID)
  if (!guild) throw new Error(`bot is not a member of guild ${GUILD_ID}`)
  const connection = joinVoiceChannel({
    guildId: guild.id,
    channelId: CHANNEL_ID,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false // we must receive audio
    // DAVE (E2EE) stays enabled: Discord's voice servers now reject non-DAVE
    // connections with close code 4017 ("E2EE/DAVE protocol required").
    // @snazzah/davey provides the native MLS layer and loads fine under Bun.
  })
  connection.on("error", (err) => log.error(err, "discord: connection error"))
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000)
  } catch {
    const status = connection.state.status
    connection.destroy()
    void client.destroy()
    throw new Error(
      status === VoiceConnectionStatus.Signalling
        ? "discord: gateway did not answer the voice join (stuck in signalling) — " +
            "usually temporary rate limiting after rapid rejoins; wait a few minutes and retry"
        : `discord: voice connection failed to become ready (stuck in ${status})`
    )
  }
  log.info({ guild: guild.name }, "discord: voice connection ready")

  // The DAVE/voice transport occasionally drops (resume, server move). Try to
  // re-establish briefly; if it doesn't come back, tear down rather than leave
  // a half-dead socket delivering duplicate receive streams.
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    log.warn("discord: voice disconnected — attempting to recover")
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000)
      ])
      // reconnecting on its own — let it ride
    } catch {
      log.error("discord: could not recover voice connection — destroying")
      connection.destroy()
    }
  })

  // --- source: the configured user's voice, decoded and downsampled ---
  // Discord only transmits packets while the user speaks, but the server VAD
  // needs actual silent audio to close a segment — inject zeros after each
  // per-utterance stream ends (2s: the VAD wants well over its 500ms
  // silence_duration_ms of tail audio before it commits).
  // The receive stream yields raw Opus packets (already DAVE-decrypted by
  // @discordjs/voice). We decode them ourselves with @discordjs/opus rather
  // than prism's opus stream, which fails to load under Bun (see opus.ts).
  const chunks = createAsyncQueue<Uint8Array>()
  // One receive stream at a time. `speaking start` can re-fire while a stream
  // is still open (and again during a voice reconnect); a second subscription
  // would feed the same utterance's audio to STT twice, producing duplicate
  // commits (server: "item already exists"). Track the active stream and ignore
  // re-fires until it closes.
  let activeStream: ReturnType<typeof connection.receiver.subscribe> | null =
    null
  connection.receiver.speaking.on("start", (userId) => {
    if (userId !== USER_ID || activeStream) return
    const opus = connection.receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: 500
      }
    })
    activeStream = opus
    const codec = createOpusCodec()
    opus.on("data", (packet: Buffer) => {
      try {
        chunks.push(downTo24kMono(codec.decode(packet)))
      } catch (err) {
        log.warn(err, "discord: opus decode failed for a packet")
      }
    })
    opus.once("close", () => {
      if (activeStream !== opus) return // superseded; already handled
      activeStream = null
      chunks.push(new Uint8Array(SAMPLE_RATE * 2 * 2))
      log.debug("discord: utterance stream ended")
    })
  })

  const source: AudioSource = {
    chunks,
    stop() {
      activeStream?.destroy()
      activeStream = null
      chunks.end()
    }
  }

  // --- sink: per-utterance AudioResource on one shared player ---
  const player = createAudioPlayer({
    // The resource stream fills at synthesis speed; without a generous
    // maxMissedFrames an underflow (5 missed 20ms frames by default) flips
    // the player Idle and truncates the utterance.
    behaviors: {
      noSubscriber: NoSubscriberBehavior.Play,
      maxMissedFrames: 250
    }
  })
  player.on("error", (err) => log.error(err, "discord: player error"))
  connection.subscribe(player)

  let playQueue: Promise<void> = Promise.resolve()

  const sink: AudioSink = {
    play(pcm) {
      // Upsample 24kHz mono -> 48kHz stereo s16le, then opus-encode ourselves
      // and hand @discordjs/voice a StreamType.Opus resource. Feeding it
      // StreamType.Raw would route through prism's opus encoder, which fails
      // to load under Bun (see opus.ts).
      const stream = new PassThrough({
        highWaterMark: 1 << 22
      })
      const up = makeUpsampler()
      const opusStream = stream.pipe(new PcmToOpus())
      const consumed = (async () => {
        for await (const chunk of pcm) stream.write(up(chunk))
        stream.end()
      })()
      playQueue = playQueue
        .then(async () => {
          player.play(
            createAudioResource(opusStream, {
              inputType: StreamType.Opus
            })
          )
          await entersState(player, AudioPlayerStatus.Playing, 10_000)
          await entersState(player, AudioPlayerStatus.Idle, 300_000)
        })
        .catch((err) => log.error(err, "discord: playback failed"))
      return {
        consumed,
        done: playQueue
      }
    },
    stop() {
      player.stop()
    }
  }

  return {
    source,
    sink,
    stop() {
      source.stop()
      sink.stop()
      connection.destroy()
      void client.destroy()
    }
  }
}
