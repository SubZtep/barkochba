# Kaja CLI  !¡ 🐓

Terminal chat with personas, tools, optional mic dictation, and optional TTS.

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

## Develop

```bash
bun install
bun run start
```

## Config

> _<sub>Everything is temporary.</sub>_

Fill all the fields here: `~/.config/kaja/config.json`

```json
{
  "braveApiKey": "",
  "openaiApiBaseUrl": "",
  "openaiApiKey": "",
  "openaiApiModel": "",
  "geoServiceUrl": "https://few-booklet-31770.ondis.co/",
  "geoServiceApiKey": "019ea05a-eacc-7ce7-8af9-e0cbf842d483"
}
```

### Collect credentials

- **Brave search**: free key from [brave.com/search/api](https://brave.com/search/api/).
- **OpenAI-compatible API** (e.g. Fireworks): set base URL, key, and model. Example:
  - `openaiApiBaseUrl`: `https://api.fireworks.ai/inference/v1`
  - `openaiApiModel`: `accounts/fireworks/models/minimax-m3`
- **Geo service**: the example URL and API key work for a while.

Optional multi-model list: `models.jsonc` in the config directory (see schema / repo copy).

## Voice & dictation

Voice features need [speaches](https://speaches.ai) for STT/TTS and `ffmpeg` / `ffplay` for mic and playback.

1. Start speaches:

   ```sh
   docker compose up -d
   # or CPU-only:
   docker compose -f compose.cpu.yaml up -d
   ```

   Default URL: `ws://localhost:8000` (override with `SPEACHES_URL`).

2. First time only — download the Kokoro TTS model on the server:

   ```sh
   curl -X POST localhost:8000/v1/models/speaches-ai/Kokoro-82M-v1.0-ONNX-fp16
   ```

3. Run the app (`bun run start`), type `/`, turn on **Toggle voice**. Dictation: Ctrl+T (see prompt indicator below).

## Prompt indicator

| Mark | Meaning |
|:----:|---------|
| >    | ready to type |
| *    | mic on, idle |
| o    | recording |
| ~    | transcribing |
| x    | muted while agent speaks |

## Test / lint

```bash
bun test
bun run lint
```
