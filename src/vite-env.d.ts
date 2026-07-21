/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPENROUTER_API_KEY?: string;
  /** Primary model tried first. */
  readonly VITE_DEFAULT_MODEL?: string;
  /** Comma-separated ordered failover models tried when the primary fails. */
  readonly VITE_MODEL_FALLBACKS?: string;
  readonly VITE_TOGGLE_HUD_ACCELERATOR?: string;
  /** Capture-into-batch hotkey (phase 8). */
  readonly VITE_CAPTURE_ACCELERATOR?: string;
  /** Send-batch-for-analysis hotkey (phase 8). */
  readonly VITE_SEND_ACCELERATOR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
