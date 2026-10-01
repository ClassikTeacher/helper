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
- [ ] Pressing the CAPTURE hotkey (`Ctrl+Alt+S` by default — `Shift+S` is often claimed by screenshot tools; override via `VITE_CAPTURE_ACCELERATOR`) captures a screenshot, shows the HUD, and adds it to the batch strip — it does **NOT** analyze yet (phase 8, decoupled capture/send)
- [ ] Pressing CAPTURE 1–5 times stacks thumbnails in the strip with a "N/5" counter; a 6th press does not add a 6th (cap); individual "✕" removes a shot, "Очистить всё" clears the batch
- [ ] Pressing the SEND hotkey (`Ctrl+Alt+Enter` by default; override via `VITE_SEND_ACCELERATOR`) — or clicking Run — analyzes the whole staged batch at once and **streams an analysis** (main scenario, plan.md §4); the now-visible HUD itself never shows up in the analyzed images (content-protected)
- [ ] Tokens stream progressively into the HUD (not all at once)
- [ ] Pressing SEND / Run with an empty batch AND an empty input shows "Нечего анализировать — сделайте скриншот (хоткей захвата) или введите текст задачи в поле ввода." instead of silently capturing
- [ ] **Text-only send:** paste a multi-line code snippet into the input with NO screenshot staged and press Run — it analyzes the pasted text (no screenshot required), the paste keeps its line breaks, and no screen capture happens; verify for both Solve and Review
- [ ] In the input, Enter submits and Shift+Enter inserts a newline
- [ ] Works for BOTH agents: repeat capture→send with Solve and with Review selected in the HUD
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
