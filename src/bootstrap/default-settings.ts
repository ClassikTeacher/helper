import { buildModelRoutes } from './model-chain';
import { DEFAULT_HOTKEYS } from './default-hotkeys';
import { fromRouteProfiles, type AppSettings } from '@/core/domain/settings';

/**
 * The build's default settings (F2): what every field is before the user
 * touches it in ⚙. Hotkeys and routes come from `VITE_*` (so `.env` keeps
 * working as the pre-seed); STT/recording/privacy mirror the native defaults
 * (`ru`, the built-in vocabulary, gate at −50 dBFS, a 60 s window,
 * `data_collection=deny`). Native `AI_HELPER_*` env vars still override the
 * values a request carries.
 */
export function buildDefaultSettings(): AppSettings {
  return {
    hotkeys: DEFAULT_HOTKEYS,
    routes: fromRouteProfiles(buildModelRoutes()),
    stt: { language: 'ru', prompt: '', silenceGate: true, silenceDbfs: -50 },
    recording: { windowSecs: 60 },
    provider: { dataCollection: 'deny', zdr: false },
  };
}
