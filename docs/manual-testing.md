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
- [ ] **Security:** with devtools open on the webview, confirm that NO IPC response ever carries the key value: the only secret commands are `secret_has` (answers with a boolean), `secret_set` (the value goes IN once, when typed) and `secret_delete`. `invoke('secret_get', …)` must fail with "command not found", and `invoke('secret_set', { request: { key: 'other', value: 'x' } })` must be rejected (`unknown secret key`). The OpenRouter request itself never appears in the renderer's network tab (it is made natively)
- [ ] **Remove key:** ⚙ → "Remove key" clears the keychain entry (`cmdkey /list` shows no `ai-helper` entry); the amber "No OpenRouter API key" banner returns
- [ ] Cancelling mid-stream stops output

### Security — links in answers (2026-10)
- [ ] Ask something whose answer contains a link (e.g. "дай ссылку на документацию Go по context"): the link renders as text with its URL in grey, is not clickable, and the HUD stays on its page
- [ ] Defense in depth: in devtools run `location.href = 'https://example.com'` — the HUD does NOT navigate; the terminal running `pnpm tauri dev` (and the native log file — see Diagnostics below) logs `overlay: blocked navigation to https://example.com/`
- [ ] The window still behaves as before (starts hidden, hotkeys show it, transparent/always-on-top, drag by header, content-protected) — it is now created in `setup()` from the same `tauri.conf.json` entry (`create: false`)

### Privacy — provider data policy (2026-10)
- [ ] Every model of the light/heavy chains still answers with the default `provider.data_collection=deny` (the OpenRouter activity log shows the served provider); if a chain model becomes unroutable, pick another provider/model rather than `AI_HELPER_DATA_COLLECTION=allow`
- [ ] With `AI_HELPER_ZDR=true` at least the primary model answers (ZDR endpoints are fewer)

### Phase 3 — Model routing
> Routing is by **route**, not by task kind: Solve runs on the `light` chain, Review on the
> `heavy` chain (R11/R16); automatic escalation by task kind was dropped (decisions.md ADR #8).

- [ ] A Solve run is served by the `light` chain's primary and a Review run by the `heavy` chain's primary (check the served model in the OpenRouter activity log; the run-info line under the answer shows usage/cost)
- [ ] Failover: with an unroutable primary (e.g. `VITE_DEFAULT_MODEL=anthropic/does-not-exist` in `.env`, rebuild) the answer still arrives from the next model of the chain, and the native log shows the retryable error followed by the second `llm_stream: model=…` line

### Agent improvements (R9–R19, 2026-09)
- [ ] **Code as text (R15):** select code in the editor, `Ctrl+C`, press `Ctrl+Alt+X` (override `VITE_PASTE_CODE_ACCELERATOR`) — the HUD shows "Код: N строк"; SEND answers from the text (reviewer cites `стр. N` matching the editor lines)
- [ ] `Ctrl+Alt+X` with an image on the clipboard shows "Буфер обмена не содержит текста…" and does NOT stop a running recording/answer
- [ ] "{ } Код текстом" toggle: paste code by hand, Run with no screenshots → a text-only answer (no capture happens); the field is cleared after a successful run, kept after a failed one
- [ ] **Run info (R9/R19):** under the answer a small line shows the model, `in→out tok` and `$cost`; with the primary model made unavailable (e.g. a bogus `VITE_LIGHT_MODEL`) the line turns amber "резервная модель · …"
- [ ] **Routes (R11/R16):** with `VITE_HEAVY_MODEL`/`VITE_HEAVY_REASONING=medium` set, a Review request reaches that model (OpenRouter activity log) and a Solve request does not; one live request confirms the provider accepts the parameters (no HTTP 400)
- [ ] **Image cap (R4/R17):** with the default 1568 edge, the request in the OpenRouter log carries a ~1568×882 image for a 2560×1440 capture; with `VITE_HEAVY_MAX_IMAGE_EDGE=2576` a Review request carries the full 2560×1440
- [ ] **Reviewer format (R14/R18):** findings look like `<Severity> — «quote» (стр. N): … Последствие: … Исправление: …`; Low items are a single "Также (Low): …" line; `стр. N` appears only when the gutter/numbered text shows it

### P0/P1 quality fixes (2026-09)
- [ ] **One active run:** press SEND twice quickly (or Run while an answer streams) — the second answer replaces the first; the two never interleave in the HUD
- [ ] **Stop:** while an answer streams, "■ Стоп" (or Esc with the HUD focused) stops it; the partial answer stays with "Остановлено."; the OpenRouter activity log shows the generation stopped (not completed)
- [ ] **Recording window:** record > 60 s (`AI_HELPER_MAX_RECORDING_SECS` to shorten) — the HUD clock keeps running and shows "в запрос уйдут последние N с"; the transcript contains the END of the speech, not the beginning
- [ ] **Multi-monitor:** with the mouse on the second monitor, the capture hotkey captures THAT monitor
- [ ] **STT vocabulary:** say "горутина", "мьютекс", "Kafka", "JOIN" — they come out spelled as terms; `AI_HELPER_STT_PROMPT=off` / `AI_HELPER_STT_LANGUAGE=auto` still transcribe
- [ ] **Silence gate (2026-10):** record ~5 s with nothing playing, press record again (stop = send) with nothing staged — the HUD says "В записи не распознано речи — отправлять нечего", the OpenRouter activity log shows NO transcription and NO chat request; with a screenshot staged the same silent recording still sends the screenshot (empty transcript)
- [ ] **Silence gate off:** with `AI_HELPER_STT_SILENCE_DBFS=off` the silent clip IS uploaded (activity log shows the transcription call); the previous default behaviour is back
- [ ] **Trim:** record 3 s silence + a sentence + 3 s silence — the transcript is complete (no clipped first/last word)
- [ ] **No key:** remove the key (⚙ → Remove key), record and stop — the error is "OpenRouter API key is not set"; re-add the key, record again — works (the recorder was not left broken)
- [ ] **Follow-up:** replaced by dialogs — see "Dialogs (2026-10)" below
- [ ] **Screen transcription:** with `VITE_AUTO_TRANSCRIBE=reviewer`, a Review shows "распознаю код…" first; with a bogus `VITE_TRANSCRIBE_MODEL` the review still arrives (screenshots only)
- [ ] **Code blocks:** answers show highlighted code with a "копировать" button; pasting after it gives the exact code
- [ ] `pnpm models:check` passes for the configured chains

### Dialogs (2026-10)
- [ ] **Dialog continues:** Solve a task from a screenshot, then type "а без доп. памяти?" and press Run (or SEND) with nothing staged — the answer addresses the same task; the bar above the answer shows "В контексте: 2 вопроса"
- [ ] **Unrelated question in the same dialog:** then capture a DIFFERENT task and SEND — the answer solves the new task from scratch (no code or constraints from the first one)
- [ ] **Typed first message:** in a new dialog, type a theory question with no screenshot and press Run — it is answered (no "Нет данных" error)
- [ ] **Modes are independent:** ask in Solve, switch to Review and ask there, switch back — Solve shows its own last answer, and its next message still has the Solve context (Review's counter is separate)
- [ ] **New dialog:** "＋ Новый диалог" in Solve clears the Solve answer and context ("Новый диалог"); Review keeps its dialog and answer
- [ ] **Restart:** after restarting the app both modes start with "Новый диалог"
- [ ] **Prompt cache:** with an Anthropic primary model, the run-info line of the 2nd+ message in a dialog shows "кэш N" (needs the prompt over the model's caching minimum, e.g. a few screenshots); the OpenRouter activity log shows the cache read
- [ ] **Nothing on disk (2026-10):** after a few dialogs, the app config dir (`%APPDATA%\com.aihelper.app`) contains no `ai-helper.db` (an old one from before the change can be deleted by hand)

### Phase 6 — Local OCR (2026-10)
- [ ] `pnpm ocr:fetch` installs into `%LOCALAPPDATA%\com.aihelper.app\ocr`: `onnxruntime.dll`, `det.onnx`, `rec.onnx`, `rec_cyrillic.onnx` (if ModelScope is unreachable it says so and installs the rest; re-run is offline from `.cache`)
- [ ] Engine check without the app: `cargo run --example ocr_check -- <screenshot.png>` (in `src-tauri`) prints `available: true, cyrillic: true` and the code with its indentation
- [ ] With `VITE_AUTO_TRANSCRIBE=all` (engine `local` by default): a Review of code on screen shows "распознаю код…" for ~1–2 s, then the answer; only ONE request in the OpenRouter activity log (no transcription call)
- [ ] Code with lone `}` / `)` lines and an editor gutter: the answer does not report "missing brace" bugs that aren't there
- [ ] A Solve task whose statement is in Russian: the answer understands the statement (Cyrillic model); with `--no-cyrillic` install it still answers from the screenshot
- [ ] Rename the OCR folder: the answer still arrives (from the screenshots) and an amber line under it says "Код не распознан… `pnpm ocr:fetch`"; restore the folder — the next request uses OCR again without restarting the app
- [ ] `VITE_TRANSCRIBE_ENGINE=cloud` brings back the model-call transcription (two requests in the activity log)

### Active-window capture (F5, 2026-10)
- [ ] With the IDE focused, press `Ctrl+Alt+W` (override `VITE_CAPTURE_WINDOW_ACCELERATOR`): the HUD shows and the strip gets a thumbnail marked "окно" containing only the IDE window (no second monitor, taskbar or chat); SEND answers from it as usual
- [ ] On a 2-monitor setup the shot is the window even when the cursor is on the other monitor
- [ ] Click into the HUD so it is the foreground window, press `Ctrl+Alt+W`: the strip gets a monitor shot (no "окно" badge) and the amber note "Активное окно недоступно для захвата — снят монитор под курсором." appears
- [ ] Minimize the IDE (focus lands elsewhere) and press `Ctrl+Alt+W` on an empty desktop: a monitor shot + the same note; no error banner
- [ ] The native log shows `capture_screen: Window WxH (… KB png) from … in … ms` for a window shot and `no capturable foreground window` / `active window capture failed` lines for the fallbacks

### Tray (F1, 2026-10)
> The app is resident: the HUD starts hidden and the process lives in the system tray.

- [ ] After start a tray icon (the app icon) appears; hovering shows "AI-Helper"; left click shows the HUD, a second left click hides it
- [ ] Right click opens the menu: "Показать / скрыть HUD", "Остановить запись и отправить" (disabled), "Запускать при входе в систему" (checkbox), "Выход"
- [ ] Start a recording (hotkey or ● button), hide the HUD: within ~1 s the tray icon gets a red dot and the tooltip reads "AI-Helper — запись 0:0N", counting up; "Остановить запись и отправить" becomes enabled
- [ ] Click "Остановить запись и отправить": the HUD comes up, the recording stops, the transcript is attached and the answer streams (same as the record hotkey's second press); the red dot disappears and the menu item is disabled again
- [ ] Stopping from the HUD (■ Стоп / hotkey) also clears the red dot
- [ ] Alt+F4 on the HUD only hides it (the tray icon stays, the hotkeys still work); "Выход" ends the process (no `AI-Helper` left in Task Manager)
- [ ] "Запускать при входе в систему": checked → `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` gains an `AI-Helper` entry (or Task Manager → Startup lists it); after sign-out/sign-in the tray icon is there; unchecking removes the entry
- [ ] The native log shows `tray: installed (autostart on|off)` and `tray: quit`

### Diagnostics (2026-10)
> Native writes a log file (`tauri-plugin-log`): `%LOCALAPPDATA%\com.aihelper.app\logs\ai-helper.log`
> (Windows; `~/.local/share/com.aihelper.app/logs/` on Linux), rotated at ~1 MB with one backup.
> Logging policy (`src-tauri/src/lib.rs`): what happened — sizes, durations, models, errors —
> never the key, prompts, screenshots, code or transcripts.

- [ ] After a capture + send the log file exists and contains `started v…`, a `capture_screen: WxH (… KB png) from … in … ms` line and an `llm_stream: model=… messages=… images=…` line followed by `llm_stream: finish reason=stop … tokens=… cost=…`
- [ ] A recording with speech logs `transcribe_audio: … s captured …` and `stt: ok on attempt 1, … bytes up, … chars back`; a silent one logs `silent under the gate — not uploaded`
- [ ] **Policy:** search the log for the API key (`sk-or-`), for a phrase you typed into the prompt and for a sentence from the transcript — none of them appear (only lengths/counts)
- [ ] Webview errors reach the file: in devtools run `console.error('probe 42')` — the log gets a `[ERROR]` line containing `probe 42`
- [ ] ⚙ → **Copy diagnostics** turns into "✓ Copied"; pasting gives `AI-Helper diagnostics`, the version/platform line, the log path and the last log lines (`(empty)` if the file is empty)
- [ ] `pnpm dev` in a browser: the button still works and pastes the stub (`platform: browser/n/a`, `(no native log in the browser)`)

## Reporting a bug

Include: mode (browser/desktop), OS, phase, steps, expected vs actual, and the
text from ⚙ → **Copy diagnostics** (version, platform, last native log lines —
safe to paste, see the logging policy above). Prefer adding a failing automated
test when possible.
