/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPENROUTER_API_KEY?: string;
  /** Primary model tried first. */
  readonly VITE_DEFAULT_MODEL?: string;
  /** Comma-separated ordered failover models tried when the primary fails. */
  readonly VITE_MODEL_FALLBACKS?: string;
  /** Per-route overrides (R11/R16) — each falls back to the base value. */
  readonly VITE_LIGHT_MODEL?: string;
  readonly VITE_LIGHT_MODEL_FALLBACKS?: string;
  readonly VITE_LIGHT_TEMPERATURE?: string;
  readonly VITE_LIGHT_REASONING?: string;
  readonly VITE_LIGHT_MAX_IMAGE_EDGE?: string;
  readonly VITE_HEAVY_MODEL?: string;
  readonly VITE_HEAVY_MODEL_FALLBACKS?: string;
  readonly VITE_HEAVY_TEMPERATURE?: string;
  readonly VITE_HEAVY_REASONING?: string;
  readonly VITE_HEAVY_MAX_IMAGE_EDGE?: string;
  readonly VITE_TOGGLE_HUD_ACCELERATOR?: string;
  /** Capture-into-batch hotkey (phase 8). */
  readonly VITE_CAPTURE_ACCELERATOR?: string;
  /** Send-batch-for-analysis hotkey (phase 8). */
  readonly VITE_SEND_ACCELERATOR?: string;
  /** Toggle-loopback-recording hotkey (phase 9). */
  readonly VITE_RECORD_ACCELERATOR?: string;
  /** Take the clipboard text as `<code_text>` (R15). */
  readonly VITE_PASTE_CODE_ACCELERATOR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
