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

## Test

```bash
pnpm test              # Vitest unit + integration
pnpm test:coverage     # with coverage
pnpm typecheck         # tsc --noEmit
```

## Layout

```
src/
  core/contracts   # IPC contract (the seam between webview and Rust)
  core/domain      # pure entities
  core/application # ports + use-cases + orchestration
  infrastructure   # adapters (tauri / llm / mocks)
  ui               # React (render only)
  bootstrap        # DI composition root
src-tauri/         # Rust core (commands / ports / services / infra)
tests/             # Vitest
```

The webview never imports `infrastructure/*` or `@tauri-apps/*` directly — it talks
to use-cases via the DI container (`useServices()`). See architecture.md §8.
