/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPENROUTER_API_KEY?: string;
  readonly VITE_DEFAULT_MODEL?: string;
  readonly VITE_TOGGLE_HUD_ACCELERATOR?: string;
  readonly VITE_SCREENSHOT_ACCELERATOR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
