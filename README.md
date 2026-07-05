# barkochba

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## Voice apps

Three entry points share the same pipeline (mic → speaches STT → Fireworks LLM → speaches TTS → speakers), built from the `lib/` modules (`stt`, `llm`, `tts`, `voice`, `brain`, `logger`):

```bash
curl -X POST localhost:8000/v1/models/speaches-ai/Kokoro-82M-v1.0-ONNX-fp16  # one-time TTS model download
bun run talk   # general voice chat
bun run game   # barkochba: think of something, answer its yes/no questions aloud
bun run care   # self-care companion that remembers past sessions (brain.sqlite)
```

Each also accepts an audio file argument as a fake user turn for testing. Ctrl+C to stop.

Latency tricks: replies stream sentence-by-sentence into TTS, and the PCM audio streams straight into one long-lived `ffplay` sink as it is synthesized — speech starts ~1s after the LLM begins answering and sentences play gaplessly, with no per-sentence player spawn. STT/TTS models are pre-warmed on startup. The mic is muted while the assistant speaks (half-duplex); playback end is computed from the PCM byte count, so listening resumes right as the speakers go quiet. If audio ever stutters mid-sentence, Kokoro is running slower than realtime on your CPU — switch `TTS_MODEL` to a piper voice.

Config via `.env`: `LLM_MODEL`, `TTS_MODEL`, `TTS_VOICE` (Kokoro voices: `af_heart`, `af_bella`, ... — see `GET /v1/registry?task=text-to-speech`), `BRAIN_DB`. If Kokoro is too slow, install a piper voice from the registry and set it as `TTS_MODEL`.

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

