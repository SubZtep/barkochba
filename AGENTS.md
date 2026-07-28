Terminal chat with personas, tools, optional mic dictation, and optional TTS.

This project uses Bun toolkit.

## Commands

* Run: `bun start`
* Lint with autofix: `bun lint`
* Test: `bun test`

## CLI

* Entry point: `cli.tsx` (Ink TUI).
* Flags: `--wizard` (config wizard), `--config` (print config path), `-c`/`--continue`, `-s`/`--session <id>`.
* Subcommands: `memory`, `session`, `telegram` — handled in `lib/memory-cli.ts`, `lib/session-cli.ts`, `lib/telegram-cli.ts`. Memory and session run before the config guard on purpose, so they work without a valid LLM config.

## Boundaries

### Always do

* Download documentation for the project version of dependencies with Context7 MCP.
* Run lint before Git commit.

### Ask first

* When anything is ambiguous.
* Refactor a code with multiple references.
* Any git mutation

### Never do

* Extend feature without discussion.

### Project Structure

Root folders:
* `assets`: Sound effect files (wav or mp3)
* `components`: Custom React (Ink) components for layout and elements
* `docs`: GitHub Pages site: install script, landing page, Telegram setup guide
* `hooks`: Custom React hooks
* `lib`: Custom code library
* `locales`: i18n language files in TOML format (en, hu)
* `patches`: Patch files for Bun `patchedDependencies`
* `schemas`: Various project specific Zod schemas
* `tests`: Unit and integration tests
* `tools`: Tools for LLM agents

### Code Style

* Biome automatically formatting and linting source files.
* Write short but explicit TSDoc.
* User-facing strings go through `t()` from `lib/i18n`, with keys in `locales/*.toml` (both languages).

### Testing

* Tests live in `tests/`, mirroring the source folders (`components`, `lib`, `schemas`, `tools`); shared helpers in `tests/test-utils.tsx`.

### Git Workflow

* Usually everything goes to `main` branch.
