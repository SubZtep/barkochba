# Kaja CLI  !¡ 🐓


## Install

> [!NOTE]  
> Only tested on Linux.

```sh
curl -fsSL https://cli.kaja.io | bash
```

### Uninstall

```sh
# find every kaja on your PATH
type -a kaja

# remove the one(s) you don't want
rm ~/.local/bin/kaja
```

## Config

> _<sub>Everything is temporary.</sub>_

Fill all the fields here here: `~/.config/kaja/config.json`

```json
{
  braveApiKey: "",
  openaiApiBaseUrl: "",
  openaiApiKey: "",
  openaiApiModel: "",
  geoServiceUrl: "https://few-booklet-31770.ondis.co/",
  geoServiceApiKey: "019ea05a-eacc-7ce7-8af9-e0cbf842d483"
}
```

### Collect Credentials

- **Brave search**: get a free key from [their website](https://brave.com/search/api/).

- **OpenAI API**: your LLM need to be compatible to the most popular format. My values:
  - openaiApiBaseUrl: `https://api.fireworks.ai/inference/v1`
  - openaiApiModel: `accounts/fireworks/models/minimax-m3`

- **Geo service**: the example URL and API key will work for a while.

---
---
---

# barkochba

To install dependencies:

```bash
bun install
```

## Voice apps

The entry points share the same pipeline (audio frontend → speaches STT → Fireworks LLM → speaches TTS → audio frontend), built from the `lib/` modules (`audio`, `stt`, `llm`, `tts`, `voice`, `brain`, `logger`):

```bash
curl -X POST localhost:8000/v1/models/speaches-ai/Kokoro-82M-v1.0-ONNX-fp16  # one-time TTS model download
bun run talk      # general voice chat (local mic/speakers)
bun run game      # barkochba: think of something, answer its yes/no questions aloud
bun run care      # self-care companion that remembers past sessions (brain.sqlite)
bun run discord   # general voice chat in a Discord voice channel
```

The local apps also accept an audio file argument as a fake user turn for testing. Ctrl+C to stop.

Audio I/O is pluggable (`lib/audio.ts` defines `AudioSource`/`AudioSink`; implementations live in `lib/frontends/`): `local` uses ffmpeg mic capture + ffplay playback, `discord` puts a bot in a voice channel, and a browser AudioWorklet frontend fits the same seam. Everything crossing the boundary is PCM16 mono 24kHz; the Discord frontend resamples to/from Discord's 48kHz stereo Opus.

### Discord

Set `DISCORD_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_CHANNEL_ID` (the voice channel to join) and `DISCORD_USER_ID` (the one user the bot listens to) in `.env`, invite the bot to the server with Connect + Speak permissions, then `bun run discord`. The bot joins on startup, transcribes the configured user's speech (a segment commits about a second after you stop talking), and answers in the channel.

Discord's voice servers now require the DAVE (E2EE) protocol — a plain connection is rejected with close code 4017. The `@snazzah/davey` native module supplies it and runs fine under Bun, so `daveEncryption` is left at its default (on).

Latency tricks: replies stream sentence-by-sentence into TTS, and the PCM audio streams straight into one long-lived `ffplay` sink as it is synthesized — speech starts ~1s after the LLM begins answering and sentences play gaplessly, with no per-sentence player spawn. STT/TTS models are pre-warmed on startup. The mic is muted while the assistant speaks (half-duplex); playback end is computed from the PCM byte count, so listening resumes right as the speakers go quiet. If audio ever stutters mid-sentence, Kokoro is running slower than realtime on your CPU — switch `TTS_MODEL` to a piper voice.

Config via `.env`: `OPENAI_API_MODEL`, `TTS_MODEL`, `TTS_VOICE` (Kokoro voices: `af_heart`, `af_bella`, ... — see `GET /v1/registry?task=text-to-speech`), `BRAIN_DB`. If Kokoro is too slow, install a piper voice from the registry and set it as `TTS_MODEL`.

## Speech-to-text (stt.ts)

Local real-time transcription via [speaches](https://speaches.ai) (faster-whisper in Docker) + ffmpeg mic capture.

```bash
docker compose -f compose.cpu.yaml up -d          # start speaches on :8000
curl -X POST localhost:8000/v1/models/Systran/faster-whisper-base.en  # one-time model download
bun stt.ts                                        # talk; phrases print as you pause
bun stt.ts some-audio.wav                         # or transcribe a file (testing)
```

Config via `.env`: `STT_MODEL`, `STT_LANGUAGE` (e.g. `hu` needs a multilingual model like `Systran/faster-whisper-small`), `SPEACHES_URL`. `LOOPBACK_HOST_URL` must stay set — it works around a speaches bug that 404s the realtime API. Logs go to stderr via pino (`LOG_LEVEL=debug` for all server events, `LOG_LEVEL=error` for transcript-only output).

Whisper encodes a fixed 30s window per segment, so short phrases cost the same as long ones;
model size sets that constant cost. Measured per segment on an i7-8550U (models already downloaded):
`tiny.en` ~0.5s · `base.en` ~1.5s (default) · `distil-small.en` ~2.7s.



TODO:

self-care chatbot app:

there is a feature when you tell a story with behviour and outcome to the global brain.

## Daemon

```
# ~/.config/systemd/user/barkochba.service
[Unit]
Description=Barkochba bot
After=network-online.target

[Service]
WorkingDirectory=%h/Code/barkochba
ExecStart=/usr/bin/bun run index.ts
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target

Then systemctl --user enable --now barkochba and
```

## Licensing

* **Code (CLI & Mobile App):** Licensed under the [Apache 2.0 License](LICENSE).
* **Model Weights:** Licensed under the [CreativeML OpenRAIL-M License](LICENSE-WEIGHTS).
