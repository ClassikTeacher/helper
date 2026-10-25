/**
 * User settings (F2, 2026-10 review §4.2/§4.3): hotkeys, model routes, STT,
 * the recording window and the provider data policy. Pure — types, defaults
 * helpers, merge/sanitize/validate/diff. Persistence is a port
 * (`SettingsPort`); defaults come from the composition root (`VITE_*`).
 *
 * The stored document is a PATCH over the defaults, not a full copy: fields
 * the user never touched keep following the build's defaults (`.env`), and
 * "reset" is an empty patch. Native `AI_HELPER_*` env vars still win over
 * the values a request carries (operator override) — see the Rust side.
 */
import {
  MAX_IMAGE_EDGE_LIMIT,
  MIN_IMAGE_EDGE_LIMIT,
  MODEL_ROUTES,
  REASONING_EFFORTS,
  type ModelRoute,
  type ModelSlug,
  type ReasoningEffort,
  type RouteProfile,
  type RouteProfiles,
} from './model-route';

export const SETTINGS_SCHEMA_VERSION = 1 as const;

// --- Shape ------------------------------------------------------------------

export interface HotkeySettings {
  readonly toggleHud: string;
  readonly capture: string;
  readonly captureWindow: string;
  readonly send: string;
  readonly record: string;
  readonly pasteCode: string;
}

export type HotkeyAction = keyof HotkeySettings;

export const HOTKEY_ACTIONS: readonly HotkeyAction[] = [
  'toggleHud',
  'capture',
  'captureWindow',
  'send',
  'record',
  'pasteCode',
];

/**
 * A route's profile as stored/edited: `null` means "off" for the optional
 * request parameters (`RouteProfile` expresses that with `undefined`, which
 * JSON cannot carry).
 */
export interface RouteSettings {
  readonly chain: readonly ModelSlug[];
  readonly temperature: number | null;
  readonly reasoningEffort: ReasoningEffort | null;
  readonly maxImageEdge: number;
}

export type RoutesSettings = Readonly<Record<ModelRoute, RouteSettings>>;

export interface SttSettings {
  /** Whisper language hint (`ru`, `en`, …); `auto` = no hint. */
  readonly language: string;
  /** Vocabulary prompt; empty = the built-in vocabulary, `off` = none. */
  readonly prompt: string;
  /** Silence gate: a silent clip is not uploaded, speech is trimmed. */
  readonly silenceGate: boolean;
  /** Gate level, dBFS (≤ 0). */
  readonly silenceDbfs: number;
}

export interface RecordingSettings {
  /** Rolling window: only the last N seconds of a recording are sent. */
  readonly windowSecs: number;
}

export type DataCollection = 'deny' | 'allow';

export interface ProviderSettings {
  /** OpenRouter `provider.data_collection`: `deny` = no-training/no-retention providers only. */
  readonly dataCollection: DataCollection;
  /** Zero-data-retention endpoints only (fewer providers). */
  readonly zdr: boolean;
}

export interface AppSettings {
  readonly hotkeys: HotkeySettings;
  readonly routes: RoutesSettings;
  readonly stt: SttSettings;
  readonly recording: RecordingSettings;
  readonly provider: ProviderSettings;
}

/** A partial update: every section and field optional. */
export interface SettingsPatch {
  readonly hotkeys?: Partial<HotkeySettings>;
  readonly routes?: Partial<Record<ModelRoute, Partial<RouteSettings>>>;
  readonly stt?: Partial<SttSettings>;
  readonly recording?: Partial<RecordingSettings>;
  readonly provider?: Partial<ProviderSettings>;
}

/** What is persisted: the user's patch over the defaults, versioned. */
export interface SettingsDocument extends SettingsPatch {
  readonly schemaVersion: typeof SETTINGS_SCHEMA_VERSION;
}

export const STT_LANGUAGE_AUTO = 'auto';
export const STT_PROMPT_OFF = 'off';
export const STT_PROMPT_MAX_CHARS = 600;
export const RECORDING_WINDOW_LIMITS = { min: 5, max: 600 } as const;
export const SILENCE_DBFS_LIMITS = { min: -90, max: 0 } as const;
export const TEMPERATURE_LIMITS = { min: 0, max: 2 } as const;

// --- Route conversions -------------------------------------------------------

export function toRouteProfile(route: RouteSettings): RouteProfile {
  return {
    chain: route.chain,
    ...(route.temperature !== null ? { temperature: route.temperature } : {}),
    ...(route.reasoningEffort ? { reasoningEffort: route.reasoningEffort } : {}),
    maxImageEdge: route.maxImageEdge,
  };
}

export function toRouteProfiles(routes: RoutesSettings): RouteProfiles {
  return { light: toRouteProfile(routes.light), heavy: toRouteProfile(routes.heavy) };
}

export function fromRouteProfile(profile: RouteProfile): RouteSettings {
  return {
    chain: profile.chain,
    temperature: profile.temperature ?? null,
    reasoningEffort: profile.reasoningEffort ?? null,
    maxImageEdge: profile.maxImageEdge,
  };
}

export function fromRouteProfiles(profiles: RouteProfiles): RoutesSettings {
  return { light: fromRouteProfile(profiles.light), heavy: fromRouteProfile(profiles.heavy) };
}

// --- Merge / diff ------------------------------------------------------------

/** `patch` over `base`, field by field; `undefined` in the patch changes nothing. */
export function mergeSettings(base: AppSettings, patch: SettingsPatch): AppSettings {
  return {
    hotkeys: { ...base.hotkeys, ...defined(patch.hotkeys) },
    routes: {
      light: { ...base.routes.light, ...defined(patch.routes?.light) },
      heavy: { ...base.routes.heavy, ...defined(patch.routes?.heavy) },
    },
    stt: { ...base.stt, ...defined(patch.stt) },
    recording: { ...base.recording, ...defined(patch.recording) },
    provider: { ...base.provider, ...defined(patch.provider) },
  };
}

/** Two patches combined: the later one wins per field. */
export function mergePatches(base: SettingsPatch, patch: SettingsPatch): SettingsPatch {
  const out: Mutable<SettingsPatch> = {};
  const hotkeys = { ...defined(base.hotkeys), ...defined(patch.hotkeys) };
  if (Object.keys(hotkeys).length > 0) out.hotkeys = hotkeys;
  const routes: Mutable<NonNullable<SettingsPatch['routes']>> = {};
  for (const route of MODEL_ROUTES) {
    const merged = { ...defined(base.routes?.[route]), ...defined(patch.routes?.[route]) };
    if (Object.keys(merged).length > 0) routes[route] = merged;
  }
  if (Object.keys(routes).length > 0) out.routes = routes;
  const stt = { ...defined(base.stt), ...defined(patch.stt) };
  if (Object.keys(stt).length > 0) out.stt = stt;
  const recording = { ...defined(base.recording), ...defined(patch.recording) };
  if (Object.keys(recording).length > 0) out.recording = recording;
  const provider = { ...defined(base.provider), ...defined(patch.provider) };
  if (Object.keys(provider).length > 0) out.provider = provider;
  return out;
}

/** The fields of `to` that differ from `from` — the patch that turns one into the other. */
export function diffSettings(from: AppSettings, to: AppSettings): SettingsPatch {
  const out: Mutable<SettingsPatch> = {};
  const hotkeys = diffFlat(from.hotkeys, to.hotkeys);
  if (hotkeys) out.hotkeys = hotkeys;
  const routes: Mutable<NonNullable<SettingsPatch['routes']>> = {};
  for (const route of MODEL_ROUTES) {
    const diff = diffFlat(
      { ...from.routes[route], chain: from.routes[route].chain.join('\n') },
      { ...to.routes[route], chain: to.routes[route].chain.join('\n') },
    );
    if (diff) {
      routes[route] = {
        ...diff,
        ...('chain' in diff ? { chain: to.routes[route].chain } : {}),
      } as Partial<RouteSettings>;
    }
  }
  if (Object.keys(routes).length > 0) out.routes = routes;
  const stt = diffFlat(from.stt, to.stt);
  if (stt) out.stt = stt;
  const recording = diffFlat(from.recording, to.recording);
  if (recording) out.recording = recording;
  const provider = diffFlat(from.provider, to.provider);
  if (provider) out.provider = provider;
  return out;
}

// --- Sanitize (from a file) --------------------------------------------------

/**
 * Keeps only the known fields with the right primitive types from whatever
 * was read from disk; everything else (unknown keys, wrong types, an old
 * schema) is dropped rather than failing the load. Semantic validity is
 * `validateSettings`' job.
 */
export function sanitizePatch(raw: unknown): SettingsPatch {
  if (!isRecord(raw)) return {};
  const out: Mutable<SettingsPatch> = {};

  if (isRecord(raw.hotkeys)) {
    const hotkeys: Mutable<Partial<HotkeySettings>> = {};
    for (const action of HOTKEY_ACTIONS) {
      const value = raw.hotkeys[action];
      if (typeof value === 'string') hotkeys[action] = value;
    }
    if (Object.keys(hotkeys).length > 0) out.hotkeys = hotkeys;
  }

  if (isRecord(raw.routes)) {
    const routes: Mutable<NonNullable<SettingsPatch['routes']>> = {};
    for (const route of MODEL_ROUTES) {
      const value = raw.routes[route];
      if (!isRecord(value)) continue;
      const parsed: Mutable<Partial<RouteSettings>> = {};
      if (Array.isArray(value.chain) && value.chain.every((m) => typeof m === 'string')) {
        parsed.chain = value.chain as string[];
      }
      if (value.temperature === null || typeof value.temperature === 'number') {
        parsed.temperature = value.temperature;
      }
      if (
        value.reasoningEffort === null ||
        (typeof value.reasoningEffort === 'string' &&
          (REASONING_EFFORTS as readonly string[]).includes(value.reasoningEffort))
      ) {
        parsed.reasoningEffort = value.reasoningEffort as ReasoningEffort | null;
      }
      if (typeof value.maxImageEdge === 'number') parsed.maxImageEdge = value.maxImageEdge;
      if (Object.keys(parsed).length > 0) routes[route] = parsed;
    }
    if (Object.keys(routes).length > 0) out.routes = routes;
  }

  if (isRecord(raw.stt)) {
    const stt: Mutable<Partial<SttSettings>> = {};
    if (typeof raw.stt.language === 'string') stt.language = raw.stt.language;
    if (typeof raw.stt.prompt === 'string') stt.prompt = raw.stt.prompt;
    if (typeof raw.stt.silenceGate === 'boolean') stt.silenceGate = raw.stt.silenceGate;
    if (typeof raw.stt.silenceDbfs === 'number') stt.silenceDbfs = raw.stt.silenceDbfs;
    if (Object.keys(stt).length > 0) out.stt = stt;
  }

  if (isRecord(raw.recording) && typeof raw.recording.windowSecs === 'number') {
    out.recording = { windowSecs: raw.recording.windowSecs };
  }

  if (isRecord(raw.provider)) {
    const provider: Mutable<Partial<ProviderSettings>> = {};
    if (raw.provider.dataCollection === 'deny' || raw.provider.dataCollection === 'allow') {
      provider.dataCollection = raw.provider.dataCollection;
    }
    if (typeof raw.provider.zdr === 'boolean') provider.zdr = raw.provider.zdr;
    if (Object.keys(provider).length > 0) out.provider = provider;
  }

  return out;
}

// --- Validate ------------------------------------------------------------------

/** Field path (`hotkeys.capture`, `routes.light.chain`, `stt.language`, …) → message. */
export type SettingsErrors = Readonly<Record<string, string>>;

export function validateSettings(settings: AppSettings): SettingsErrors {
  const errors: Record<string, string> = {};

  const seen = new Map<string, HotkeyAction>();
  for (const action of HOTKEY_ACTIONS) {
    const value = settings.hotkeys[action].trim();
    if (!value) {
      errors[`hotkeys.${action}`] = 'Укажите сочетание клавиш';
      continue;
    }
    if (!isValidAccelerator(value)) {
      errors[`hotkeys.${action}`] =
        'Нужен хотя бы один модификатор (Ctrl/Alt/Super) и одна клавиша, например CommandOrControl+Alt+Shift+K';
      continue;
    }
    const key = value.toLowerCase();
    const other = seen.get(key);
    if (other) {
      errors[`hotkeys.${action}`] = `Уже используется для «${other}»`;
      errors[`hotkeys.${other}`] = `Уже используется для «${action}»`;
    } else {
      seen.set(key, action);
    }
  }

  for (const route of MODEL_ROUTES) {
    const value = settings.routes[route];
    const chain = value.chain.map((m) => m.trim()).filter((m) => m.length > 0);
    if (chain.length === 0) {
      errors[`routes.${route}.chain`] = 'Нужна хотя бы одна модель (слаг OpenRouter, например anthropic/claude-haiku-4.5)';
    } else {
      const bad = chain.find((m) => !isModelSlug(m));
      if (bad) errors[`routes.${route}.chain`] = `Не похоже на слаг модели OpenRouter: «${bad}»`;
    }
    if (
      value.temperature !== null &&
      !(
        Number.isFinite(value.temperature) &&
        value.temperature >= TEMPERATURE_LIMITS.min &&
        value.temperature <= TEMPERATURE_LIMITS.max
      )
    ) {
      errors[`routes.${route}.temperature`] = `Температура — число от ${TEMPERATURE_LIMITS.min} до ${TEMPERATURE_LIMITS.max}, или выключена`;
    }
    if (value.reasoningEffort !== null && !REASONING_EFFORTS.includes(value.reasoningEffort)) {
      errors[`routes.${route}.reasoningEffort`] = 'Reasoning: off, low, medium или high';
    }
    if (
      !Number.isInteger(value.maxImageEdge) ||
      value.maxImageEdge < MIN_IMAGE_EDGE_LIMIT ||
      value.maxImageEdge > MAX_IMAGE_EDGE_LIMIT
    ) {
      errors[`routes.${route}.maxImageEdge`] = `Длинная сторона картинки — целое от ${MIN_IMAGE_EDGE_LIMIT} до ${MAX_IMAGE_EDGE_LIMIT} px`;
    }
  }

  const language = settings.stt.language.trim();
  if (language !== STT_LANGUAGE_AUTO && !/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(language)) {
    errors['stt.language'] = 'Код языка (ru, en, de…) или auto';
  }
  if (settings.stt.prompt.length > STT_PROMPT_MAX_CHARS) {
    errors['stt.prompt'] = `Подсказка словаря — не длиннее ${STT_PROMPT_MAX_CHARS} символов`;
  }
  if (
    !Number.isFinite(settings.stt.silenceDbfs) ||
    settings.stt.silenceDbfs < SILENCE_DBFS_LIMITS.min ||
    settings.stt.silenceDbfs > SILENCE_DBFS_LIMITS.max
  ) {
    errors['stt.silenceDbfs'] = `Порог тишины — от ${SILENCE_DBFS_LIMITS.min} до ${SILENCE_DBFS_LIMITS.max} dBFS`;
  }

  if (
    !Number.isInteger(settings.recording.windowSecs) ||
    settings.recording.windowSecs < RECORDING_WINDOW_LIMITS.min ||
    settings.recording.windowSecs > RECORDING_WINDOW_LIMITS.max
  ) {
    errors['recording.windowSecs'] = `Окно записи — целое от ${RECORDING_WINDOW_LIMITS.min} до ${RECORDING_WINDOW_LIMITS.max} с`;
  }

  if (settings.provider.dataCollection !== 'deny' && settings.provider.dataCollection !== 'allow') {
    errors['provider.dataCollection'] = 'deny или allow';
  }

  return errors;
}

/** Drops from `patch` every field named in `errors` (a path per entry). */
export function dropInvalidFields(patch: SettingsPatch, errors: SettingsErrors): SettingsPatch {
  const out = structuredClone(patch) as Mutable<SettingsPatch> & {
    routes?: Record<string, Record<string, unknown>>;
  } & Record<string, Record<string, unknown> | undefined>;
  for (const path of Object.keys(errors)) {
    const [section, second, third] = path.split('.');
    if (section === 'routes' && second && third) {
      delete out.routes?.[second]?.[third];
    } else if (section && second) {
      delete out[section]?.[second];
    }
  }
  return out as SettingsPatch;
}

// --- Accelerators / slugs ----------------------------------------------------

const MODIFIERS = new Set([
  'commandorcontrol',
  'cmdorctrl',
  'command',
  'cmd',
  'control',
  'ctrl',
  'alt',
  'option',
  'altgr',
  'shift',
  'super',
  'meta',
]);

const NAMED_KEYS = new Set([
  'space',
  'tab',
  'backspace',
  'delete',
  'insert',
  'enter',
  'return',
  'escape',
  'esc',
  'up',
  'down',
  'left',
  'right',
  'home',
  'end',
  'pageup',
  'pagedown',
  'plus',
  'printscreen',
  'scrolllock',
  'numlock',
  'capslock',
  'numadd',
  'numsub',
  'nummult',
  'numdiv',
  'numdec',
  ...Array.from({ length: 10 }, (_, i) => `num${i}`),
]);

/**
 * Tauri/Electron accelerator syntax: modifiers joined by `+`, then exactly one
 * key. A global hotkey needs at least one modifier that is not Shift alone
 * (`Shift+A` would swallow typing). Pure.
 */
export function isValidAccelerator(value: string): boolean {
  const tokens = value.split('+').map((t) => t.trim());
  if (tokens.length < 2 || tokens.some((t) => t.length === 0)) return false;
  const key = tokens[tokens.length - 1]!;
  const modifiers = tokens.slice(0, -1).map((t) => t.toLowerCase());
  if (!modifiers.every((m) => MODIFIERS.has(m))) return false;
  if (!modifiers.some((m) => m !== 'shift')) return false;
  return isKeyToken(key);
}

function isKeyToken(key: string): boolean {
  if (/^[a-z0-9]$/i.test(key)) return true;
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(key)) return true;
  if (/^[`\-=[\]\\;',./]$/.test(key)) return true;
  return NAMED_KEYS.has(key.toLowerCase());
}

/** `vendor/model[:variant]` — the shape of an OpenRouter slug. */
export function isModelSlug(value: string): boolean {
  return /^[a-z0-9][\w.-]*\/[\w.:-]+$/i.test(value);
}

// --- helpers -------------------------------------------------------------------

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The entries of `value` whose values are defined (so a spread never sets `undefined`). */
function defined<T extends object>(value: T | undefined): Partial<T> {
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function diffFlat<T extends object>(from: T, to: T): Partial<T> | null {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(to) as (keyof T & string)[]) {
    if (!Object.is(from[key], to[key])) out[key] = to[key];
  }
  return Object.keys(out).length > 0 ? (out as Partial<T>) : null;
}
