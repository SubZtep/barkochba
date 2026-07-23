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
# find every kaja on your PATH (optional)
type -a kaja

# remove the one(s) you don't want
rm ~/.local/bin/kaja
```

## Config

Fill all the fields here: `~/.config/kaja/config.json` — or let the setup
wizard do it: it opens automatically when the config is missing or invalid, 
and anytime via `kaja --wizard` .

Config is grouped by feature. `llm` is required — the app can't run without a
model. Everything else is an optional group: `stt` , `tts` , `location` , and
`webSearch` (Brave Search API). Leaving a group out of the config (or blank in the wizard)
simply leaves that one feature unavailable — dictation/TTS stay off, and the
`my_location` / `web_search` tools aren't offered to the model.

### Where to get credentials?

* **OpenAI API** (`llm`) : any compatible LLM (e.g. MiniMax M3) with REST API works (e.g. Ollama, Fireworks AI).
* **Web search** (`webSearch`) : get a free key from [Brave's website](https://brave.com/search/api/).
* **Location** (`location`) : the example URL and API key work for a while.

Optional multi-model list: `models.toml` in the config directory (a commented template is written on first run).

### Language

English or Magyar, covering the UI and the assistant's replies. The setup wizard ( `kaja --wizard` ) starts with a language picker, saved as `settings.language` and read once at startup; without a saved choice the system locale decides (a Hungarian locale → Magyar, anything else → English).

Voice caveat for Hungarian: dictation needs the multilingual whisper model on the STT server (the English default is an English-only model; 

set `stt.model` / `stt.language` in the config file to override), and spoken replies stay with the configured Kokoro voice (no Hungarian voice) unless `tts.model` / `tts.voice` point somewhere Hungarian-capable.

## Voice & dictation

Voice features (the optional `stt` / `tts` config groups) need [speaches](https://speaches.ai) for STT/TTS and `ffmpeg` / `ffplay` for mic and playback.

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
