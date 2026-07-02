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

### Phase 2 — LLM streaming
- [ ] Submitting a prompt streams tokens progressively (not all at once)
- [ ] Invalid/missing API key surfaces a readable error (no silent failure)
- [ ] Cancelling mid-stream stops output

### Phase 3 — Model routing
- [ ] A "vision" task and a "quick-answer" task hit different models (verify via OpenRouter dashboard/logs)

### Phase 4 — Context
- [ ] History persists across app restarts
- [ ] Relevant prior context is recalled

## Reporting a bug

Include: mode (browser/desktop), OS, phase, steps, expected vs actual,
console/terminal output. Prefer adding a failing automated test when possible.
