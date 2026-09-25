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
- [ ] Pressing SEND / Run with an empty batch (and no code text) shows "Нет данных для анализа — сделайте хотя бы один скриншот (хоткей захвата) или вставьте код текстом." instead of silently capturing
- [ ] Works for BOTH agents: repeat capture→send with Solve and with Review selected in the HUD
- [ ] Missing/invalid API key surfaces a readable error in the HUD (no silent failure)
- [ ] If an error arrives mid-stream (e.g. kill network), any partial answer already streamed stays visible alongside the error ("Interrupted: …"), not replaced by it
- [ ] **Security:** with devtools open on the webview, confirm the API key never appears in memory/network of the renderer process (only `secret_get`/`secret_set` IPC calls touch it, never the OpenRouter request itself)
- [ ] Cancelling mid-stream stops output

### Phase 3 — Model routing
- [ ] A "vision" task and a "quick-answer" task hit different models (verify via OpenRouter dashboard/logs)

### Agent improvements (R9–R19, 2026-09)
- [ ] **Code as text (R15):** select code in the editor, `Ctrl+C`, press `Ctrl+Alt+X` (override `VITE_PASTE_CODE_ACCELERATOR`) — the HUD shows "Код: N строк"; SEND answers from the text (reviewer cites `стр. N` matching the editor lines)
- [ ] `Ctrl+Alt+X` with an image on the clipboard shows "Буфер обмена не содержит текста…" and does NOT stop a running recording/answer
- [ ] "{ } Код текстом" toggle: paste code by hand, Run with no screenshots → a text-only answer (no capture happens); the field is cleared after a successful run, kept after a failed one
- [ ] **Run info (R9/R19):** under the answer a small line shows the model, `in→out tok` and `$cost`; with the primary model made unavailable (e.g. a bogus `VITE_LIGHT_MODEL`) the line turns amber "резервная модель · …"
- [ ] **Routes (R11/R16):** with `VITE_HEAVY_MODEL`/`VITE_HEAVY_REASONING=medium` set, a Review request reaches that model (OpenRouter activity log) and a Solve request does not; one live request confirms the provider accepts the parameters (no HTTP 400)
- [ ] **Image cap (R4/R17):** with the default 1568 edge, the request in the OpenRouter log carries a ~1568×882 image for a 2560×1440 capture; with `VITE_HEAVY_MAX_IMAGE_EDGE=2576` a Review request carries the full 2560×1440
- [ ] **Reviewer format (R14/R18):** findings look like `<Severity> — «quote» (стр. N): … Последствие: … Исправление: …`; Low items are a single "Также (Low): …" line; `стр. N` appears only when the gutter/numbered text shows it

### Phase 4 — Context
- [ ] History persists across app restarts
- [ ] Relevant prior context is recalled

## Reporting a bug

Include: mode (browser/desktop), OS, phase, steps, expected vs actual,
console/terminal output. Prefer adding a failing automated test when possible.
