# Kaja CLI  !¡ 🐓

Terminal chat with personas, tools, optional mic dictation, and optional TTS.

## Install

> [! NOTE]  
> Only tested on Linux.

```sh
curl -fsSL https://cli.kaja.io | bash
```

### Uninstall

```sh
# find every kaja on your PATH (optional)
type -a kaja

# remove the one(s) you don't want
rm ~/.local/bin/kaja
```

## Config

Fill all the fields here: `~/.config/kaja/config.json` — or let the setup
wizard do it: it opens automatically when the config is missing or invalid, 
and anytime via `kaja --wizard` .

### Where to get credentials?

* **Brave search** : get a free key from [their website](https://brave.com/search/api/).
* **OpenAI API** : any compatible LLM (e.g. MiniMax M3) with REST API works (e.g. Ollama, Fireworks AI).
* **Geo service** : the example URL and API key work for a while.

Optional multi-model list: `models.toml` in the config directory (a commented template is written on first run).

### Language

English or Magyar, covering the UI and the assistant's replies. The setup wizard ( `kaja --wizard` ) starts with a language picker, saved as `settings.language` and read once at startup; without a saved choice the system locale decides (a Hungarian locale → Magyar, anything else → English).

Voice caveat for Hungarian: dictation needs the multilingual whisper model on the STT server (the English default is an English-only model;

set `voice.sttModel` / `voice.sttLanguage` in the config file to override), and spoken replies stay with the configured Kokoro voice (no Hungarian voice) unless `voice.ttsModel` / `voice.ttsVoice` point somewhere Hungarian-capable.

## Voice & dictation

Voice features need [speaches](https://speaches.ai) for STT/TTS and `ffmpeg` / `ffplay` for mic and playback.

1. Start speaches:

   

```sh
   docker compose up -d
   # or CPU-only:
   docker compose -f compose.cpu.yaml up -d
   ```

   Default URL: `ws://localhost:8000` (override with `voice.speachesUrl` in the config file, or the setup wizard's Voice group).

2. First time only — download the Kokoro TTS model on the server:

   

```sh
   curl -X POST localhost:8000/v1/models/speaches-ai/Kokoro-82M-v1.0-ONNX-fp16
   ```

3. Run the app (`bun run start`), type `/`, turn on **Toggle voice** . Dictation: Ctrl+T (see prompt indicator below).

## Hotkeys

### Input field

| Key | Action |
|-----|--------|
| Enter | send message |
| Shift+Enter / Alt+Enter / Ctrl+Enter / Ctrl+J | insert newline |
| ↑ / ↓ | move cursor between lines (sticky column) |
| ← / → | move cursor by character |
| Ctrl+← / Ctrl+→ (or Alt+←/→) | jump by word |
| Home / End | start / end of current line |
| `/` on empty input | open menu |
| Ctrl+T | toggle mic dictation |

### Chat scrolling

| Key | Action |
|-----|--------|
| Mouse wheel | scroll chat |
| PageUp / PageDown | scroll by a page |
| Ctrl+↑ / Ctrl+↓ | scroll by a few lines |
| Ctrl+Home | jump to oldest message |
| Ctrl+End | jump to newest & follow |

### Menu

| Key | Action |
|-----|--------|
| ↑ / ↓ | move selection |
| Enter | select |
| Esc / Backspace | close menu |

### App

| Key | Action |
|-----|--------|
| Esc | quit (closes menu first if open) |
| Ctrl+C | quit |

## Prompt indicator

| Mark | Meaning |
|:----:|---------|
| >    | ready to type |
| *    | mic on, idle |
| o    | recording |
| ~    | transcribing |
| x    | muted while agent speaks |

## Develop

```bash
bun install
bun start
```

## Test / lint

```bash
bun test
bun lint # write immediately
```
