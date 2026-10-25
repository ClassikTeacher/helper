# AI-Helper (app)

Desktop AI screen-assistant. **Hotkey → screenshot → analyze → stream answer into an overlay HUD.**

- Decisions & current state: [`../decisions.md`](../decisions.md) ← start here to continue work
- Architecture: [`../architecture.md`](../architecture.md)
- Roadmap & tasks: [`../tasks.md`](../tasks.md)
- Dev setup & troubleshooting: [`docs/development-setup.md`](docs/development-setup.md)
- Manual testing: [`docs/manual-testing.md`](docs/manual-testing.md)

## Privacy of what is sent

Screenshots (often of someone else's shared screen) and the interlocutor's voice
transcript go through OpenRouter to an upstream provider. Every chat request
carries `provider: { data_collection: "deny" }`, so OpenRouter routes only to
providers whose published policy is not to store or train on prompts
(`AI_HELPER_DATA_COLLECTION=allow` relaxes it; `AI_HELPER_ZDR=true` restricts
further to zero-data-retention endpoints — fewer providers). Also turn off
request logging in your OpenRouter account settings; that part is not under the
app's control. The STT upload (`/audio/transcriptions`) carries no provider
preference — unverified whether the endpoint accepts one.

## Native runtime overrides (`AI_HELPER_*`)

Read by the Rust core at runtime (process environment) — unlike `VITE_*`, which
are compiled into the webview. All optional.

| Variable | Default | Meaning |
|---|---|---|
| `AI_HELPER_MAX_RECORDING_SECS` | `60` | Rolling window of loopback recording — the LAST N seconds are kept |
| `AI_HELPER_STT_LANGUAGE` | `ru` | Whisper language hint; `auto` sends none |
| `AI_HELPER_STT_PROMPT` | built-in vocabulary | Whisper `prompt` (domain terms); `off` sends none |
| `AI_HELPER_STT_SILENCE_DBFS` | `-50` | Silence gate: frames below this are silence; a silent clip is not uploaded; `off` disables the gate |
| `AI_HELPER_STT_TIMEOUT_MS` | `8000` | Base per-attempt STT timeout (server work); upload time is added per clip size |
| `AI_HELPER_STT_UPLOAD_KBPS` | `125` | Assumed worst-case uplink (KB/s) used to size the upload part of the STT timeout |
| `AI_HELPER_LLM_CONNECT_TIMEOUT_MS` | `10000` | TCP/TLS connect timeout for OpenRouter |
| `AI_HELPER_LLM_FIRST_BYTE_TIMEOUT_MS` | `30000` | Budget until the first byte of the response body; a miss is a retryable error → failover |
| `AI_HELPER_LLM_IDLE_TIMEOUT_MS` | `60000` | Longest silence between body chunks while streaming (keep-alive comments count) |
| `AI_HELPER_DATA_COLLECTION` | `deny` | OpenRouter `provider.data_collection`; `allow` = default routing |
| `AI_HELPER_ZDR` | unset | `true` routes only to zero-data-retention endpoints |

## Diagnostics and logs

Native writes a rotating log file via `tauri-plugin-log` (~1 MB, one backup kept;
also stdout in `pnpm tauri dev`):

| OS | Path |
|---|---|
| Windows | `%LOCALAPPDATA%\com.aihelper.app\logs\ai-helper.log` |
| Linux | `~/.local/share/com.aihelper.app/logs/ai-helper.log` |

**Logging policy** (`src-tauri/src/lib.rs`): the log records *what happened* — command
names, sizes, durations, model slugs, finish reasons, token/cost accounting, error
messages — and never the API key, prompt text, screenshots, code or transcripts (only
their lengths). Webview `console.error`/`console.warn`, uncaught errors and unhandled
rejections are mirrored into the same file. For a bug report use **⚙ → Copy diagnostics**:
it copies the app version, platform, log path and the last log lines (`diagnostics_snapshot`
command), which is safe to paste as-is.

## Security model (what secure-native does and does not cover)

- The OpenRouter key lives in the OS keychain and is read only by native code at
  the moment of the provider call. The webview has no command that returns a
  secret value (`secret_has`/`secret_set`/`secret_delete` only, keys allow-listed),
  so a compromised renderer (XSS, a malicious npm dependency) cannot read it.
- That boundary is the webview. The Windows Credential Manager entry is readable
  by any process running as the same user — same as every desktop app's secrets;
  protecting against a compromised user account is out of scope.
- The webview's IPC surface is kept to what the use-cases need: screen capture,
  LLM/STT streaming, write-only secrets, overlay, global hotkeys, clipboard read
  (paste-code hotkey), key/value store. No SQL, no filesystem, no shell.
- Model output, screenshot text and transcripts are untrusted input: links never
  navigate, raw HTML is escaped, the webview may only load the app's own origin,
  and the prompts treat on-screen/spoken text as data, not instructions.

## Stack

Tauri v2 (Rust core) · React + Vite + TypeScript · Tailwind · Zustand · OpenRouter called from
native (`reqwest` + SSE; the Vercel AI SDK adapter is dev-only). No database: dialogs live in
memory for the lifetime of the process and nothing is written to disk.

## Prerequisites

- Node 22+ and pnpm
- Rust toolchain (`rustup`, stable) — required for the Tauri core
- Windows: WebView2 runtime (bundled on Win 11)

## Setup

```bash
pnpm install
cp .env.example .env   # optional: models/hotkeys tuning (no secrets here)
```

The OpenRouter API key is entered once in the app (⚙ in the HUD) and stored in
the OS keychain — never in `.env`. For `pnpm dev` convenience a throwaway key may
go into `.env.development.local` (git-ignored, loaded by dev mode only; production
builds define the variable away — see `vite.config.ts`).

## Develop

```bash
pnpm tauri dev     # runs Vite + Tauri (requires Rust)
pnpm dev           # webview only, in a browser (native ports are stubbed)
```

## Local OCR (optional)

```bash
pnpm ocr:fetch     # once per machine: ONNX Runtime + PP-OCR models (~60 MB, verified by SHA-256)
```

Then set `VITE_AUTO_TRANSCRIBE=all` in `.env`: the code on screenshots is read
on-device and sent to the model as text next to the images. See `.env.example`.

## Test

```bash
pnpm test              # Vitest unit + integration + contract
pnpm test:coverage     # with coverage
pnpm typecheck         # tsc --noEmit (also validates the generated contract fixtures)
pnpm lint              # eslint (incl. the ui → infrastructure/@tauri-apps import ban)
cargo test --lib --manifest-path src-tauri/Cargo.toml   # Rust unit tests (Windows target)
pnpm models:check      # model slugs vs OpenRouter — needs network to openrouter.ai
```

**CI** (`.github/workflows/ci.yml`) runs typecheck + lint + Vitest on Linux and the Rust
lib tests on `windows-latest` for every pull request to `main` (and on demand).

**Contract drift guard.** `tests/contract/dto-fixtures.generated.ts` is produced by a
Rust test from the serde DTOs and typechecked against `src/core/contracts/dto.ts`;
`tests/contract/ipc-commands.test.ts` compares `IPC_COMMANDS` with `generate_handler!`.
After changing `src-tauri/src/dto.rs`, regenerate in the same commit:

```bash
UPDATE_CONTRACT_FIXTURES=1 cargo test --lib --manifest-path src-tauri/Cargo.toml contract_fixtures
```

**Rust tests outside Windows:** `cargo test --target x86_64-pc-windows-gnu --lib` under
wine with two stub DLLs (`WebView2Loader.dll`, `coremessaging.dll`) — see architecture.md §10.

**Model catalog.** The slugs in `src/core/domain/model-route.ts` are placeholders and the
catalog is stale (the current generation is Claude 5.5); run `pnpm models:check` on a
machine with access to openrouter.ai and update `AVAILABLE_MODELS` / `.env` accordingly
(the agent's dev environment cannot reach it).

## Layout

```
src/
  core/contracts   # IPC contract (the seam between webview and Rust)
  core/domain      # pure entities
  core/application # ports + use-cases + orchestration
  infrastructure   # adapters (tauri / llm / mocks)
  ui               # React (render only)
  bootstrap        # DI composition root
src-tauri/         # Rust core (commands / ports / services / infra; contract_fixtures.rs = test-only)
tests/             # Vitest: unit/ integration/ contract/ (generated DTO fixtures + IPC command test)
.github/workflows/ # CI: webview checks on Linux, Rust lib tests on Windows (pull requests)
```

The webview never imports `infrastructure/*` or `@tauri-apps/*` directly — it talks
to use-cases via the DI container (`useServices()`). See architecture.md §8.
