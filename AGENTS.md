Terminal chat with personas, tools, optional mic dictation, and optional TTS.

This project uses Bun toolkit.

## Commands

* Run: `bun start`
* Lint with autofix: `bun lint`
* Test: `bun test`

## Boundaries

### Always do

* Download documentation for the project version of dependencies with Codex7 MCP.
* Run lint before Git commit.

### Ask first

* When anything is ambiguous.
* Refactor a code with multiple references.

### Never do

* Git push without explicit permission.
* Extend feature without discussion.

### Project Structure

Root folders:
* `assets`: Sound effect files (wav or mp3)
* `components`: Custom React components for layout and elements
* `docs`: Installer script for users
* `hooks`: Custom React hooks
* `lib`: Custom code library
* `locales`: i18n language files in TOML format
* `schemas`: Various project specific Zod schemas
* `tests`: Unit and integration tests
* `tools`: Tools for LLM agents

### Code Style

* Biome automatically formatting and linting source files.
* Write short but explicit TSDoc.

### Testing

* Simple static tests are in the `tests/` folder.

### Git Workflow

* Usually everything goes to `main` branch.
