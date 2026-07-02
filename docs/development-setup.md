# Development Setup & Troubleshooting

Operational context for running the project. See also
[../../decisions.md](../../decisions.md) (state/decisions) and
[../../architecture.md](../../architecture.md).

## Prerequisites

| Tool | Version (verified) | Notes |
|------|--------------------|-------|
| Node | 22.x | present |
| pnpm | 10.x | present |
| Rust (cargo/rustc) | 1.96.1 | installed at `~/.cargo/bin` (`C:\Users\<you>\.cargo\bin`) |
| WebView2 runtime | 149+ | present on Win 11 |
| MSVC Build Tools | — | required by the `msvc` Rust toolchain (linker). Present (Rust core compiles). |

## First-time setup

```bash
cd app
pnpm install
pnpm rebuild esbuild     # pnpm 10 skips build scripts by default; Vite/Vitest need esbuild's binary
cp .env.example .env      # optional dev convenience
```

## Running

```bash
pnpm dev          # webview only, opens http://localhost:1420 with FAKE adapters (no native, no API key)
pnpm tauri dev    # full desktop app (Rust core + native window); requires cargo on PATH
pnpm build        # tsc --noEmit + vite build -> dist/
pnpm test         # Vitest
pnpm typecheck    # tsc --noEmit
```

## Verified green (phase 0.2)

- `pnpm typecheck` — clean
- `pnpm test` — 3/3
- `cargo check --all-targets` — clean (run from `app/src-tauri`)

## Troubleshooting

### `cargo`/`rustc`/`cargo metadata` "program not found" (e.g. `pnpm tauri dev` fails)

Cause: `~/.cargo/bin` is in the persistent Windows user PATH, but the terminal (and
its parent process tree — explorer/IDE) was launched **before** Rust was installed, so
it inherited a stale environment. Even a "new" Git Bash from that stale parent misses it.

Permanent fix (already applied to this machine):
- `~/.bashrc` appends `export PATH="$HOME/.cargo/bin:$PATH"`.
- `~/.bash_profile` created to source `~/.bashrc` (Git Bash opens **login** shells).
- Verified: `bash -lc 'cargo --version'` resolves cargo.

To pick it up **now** without a full logout:
- New Git Bash terminal will work (login shell sources the profile), **or**
- In the current shell: `source ~/.bash_profile` (or `export PATH="$HOME/.cargo/bin:$PATH"`).
- PowerShell equivalent: `$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"`.

A full Windows sign-out/in also refreshes the process tree so no shell tweak is needed.

### cargo can't reach crates.io / "Could not resolve proxy name"

Cause (seen once): a broken `http.proxy = /` in the **global git config** (cargo uses
git's proxy as a fallback). Fixed via:
```bash
git config --global --unset-all http.proxy
```
Check with `git config --global --get-regexp '^https?\.proxy$'` (should be empty).

### `tauri-build`: `icons/icon.ico not found`

Cause: `tauri-build` embeds a Windows resource icon even for `cargo check`.
Fix: icons are generated into `src-tauri/icons/` via `pnpm tauri icon app-icon.png`
(source `app-icon.png` is a generated 512x512 placeholder — replace with a real logo later).

### `pnpm dev` shows fake responses

Expected: in a plain browser there's no Tauri, so the DI container (`src/bootstrap/container.ts`)
falls back to `FakeLlmAdapter` / `FakeScreenCaptureAdapter`. Use `pnpm tauri dev` for real behavior.
