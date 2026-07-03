# Manual Testing Guide

Complements the automated tests (Vitest / `cargo test`). Fill in per phase.
Automated coverage is primary; this doc covers what's hard to assert in code
(native windows, hotkeys, real streaming).

## Test environments

| Mode | Command | What it exercises |
|------|---------|-------------------|
| Browser-only | `pnpm dev` → open http://localhost:1420 | UI + logic with **fake** adapters (no native, no LLM key) |
| Full desktop | `pnpm tauri dev` | Real Rust core, native window, hotkeys, real LLM (needs Rust + key) |

## Smoke checklist (run before each release)

### Phase 0 — Shell
- [ ] `pnpm dev` opens the HUD in a browser without console errors
- [ ] `pnpm tauri dev` launches a transparent, always-on-top window
- [ ] The HUD shows the placeholder "Press the hotkey or ask something…"

### Phase 0.3 — Hotkey / overlay
- [ ] Pressing the global hotkey toggles the HUD (show/hide)
- [ ] Hotkey works when another app is focused

### Phase 1 — Capture
- [ ] Triggering capture shows a screenshot preview in the HUD
- [ ] Multi-monitor: correct display is captured

### Phase 2 — LLM streaming (secure-native)
> Set the API key once via the HUD: click ⚙ (top-right), paste the key into
> the "OpenRouter API key" field, click Save. It persists across restarts
> (real OS keychain, see decisions.md "SecretStore").

- [ ] With no key configured yet, the HUD shows an amber "No OpenRouter API key configured — click ⚙ to add one" banner
- [ ] Entering a key in the ⚙ settings panel and saving shows "Key configured ✓"; the banner disappears after reopening/re-reading status
- [ ] Pressing the screenshot hotkey (`Ctrl+Alt+S` by default — `Shift+S` is often claimed by screenshot tools; override via `VITE_SCREENSHOT_ACCELERATOR`) captures, shows the HUD, **and automatically streams an analysis** — no need to type a question first (main scenario, plan.md §4)
- [ ] Tokens stream progressively into the HUD (not all at once)
- [ ] A follow-up question typed in the prompt box re-analyzes the **same** pinned screenshot (check: no second capture, and the now-visible HUD itself never shows up in the analyzed image)
- [ ] Typing a question with no screenshot pinned yet (HUD opened via the toggle hotkey) shows "No screenshot yet — press the screenshot hotkey first." instead of silently capturing
- [ ] Missing/invalid API key surfaces a readable error in the HUD (no silent failure)
- [ ] If an error arrives mid-stream (e.g. kill network), any partial answer already streamed stays visible alongside the error ("Interrupted: …"), not replaced by it
- [ ] **Security:** with devtools open on the webview, confirm the API key never appears in memory/network of the renderer process (only `secret_get`/`secret_set` IPC calls touch it, never the OpenRouter request itself)
- [ ] Cancelling mid-stream stops output

### Phase 3 — Model routing
- [ ] A "vision" task and a "quick-answer" task hit different models (verify via OpenRouter dashboard/logs)

### Phase 4 — Context
- [ ] History persists across app restarts
- [ ] Relevant prior context is recalled

## Reporting a bug

Include: mode (browser/desktop), OS, phase, steps, expected vs actual,
console/terminal output. Prefer adding a failing automated test when possible.
