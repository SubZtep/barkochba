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

