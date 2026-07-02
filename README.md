# AI-Helper (app)

Desktop AI screen-assistant. **Hotkey → screenshot → analyze → stream answer into an overlay HUD.**

- Decisions & current state: [`../decisions.md`](../decisions.md) ← start here to continue work
- Architecture: [`../architecture.md`](../architecture.md)
- Roadmap & tasks: [`../tasks.md`](../tasks.md)
- Dev setup & troubleshooting: [`docs/development-setup.md`](docs/development-setup.md)
- Manual testing: [`docs/manual-testing.md`](docs/manual-testing.md)

## Stack

Tauri v2 (Rust core) · React + Vite + TypeScript · Tailwind · Zustand · Vercel AI SDK + OpenRouter · SQLite + sqlite-vec.

## Prerequisites

- Node 22+ and pnpm
- Rust toolchain (`rustup`, stable) — required for the Tauri core
- Windows: WebView2 runtime (bundled on Win 11)

## Setup

```bash
pnpm install
cp .env.example .env   # optional, dev convenience
```

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
  infrastructure   # adapters (tauri / llm / persistence / mocks)
  ui               # React (render only)
  bootstrap        # DI composition root
src-tauri/         # Rust core (commands / ports / services / infra)
tests/             # Vitest
```

The webview never imports `infrastructure/*` or `@tauri-apps/*` directly — it talks
to use-cases via the DI container (`useServices()`). See architecture.md §8.
