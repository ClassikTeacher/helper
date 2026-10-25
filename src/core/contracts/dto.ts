/**
 * IPC DTOs — the data shapes crossing the webview <-> Rust-core seam.
 *
 * These MUST stay in sync with `src-tauri/src/dto.rs` (serde structs).
 * This file is the single source of truth for the TS side of the contract.
 * Changing a shape here is a contract change — version it deliberately.
 *
 * See architecture.md §3 "IPC-контракт".
 */

/**
 * Region of the screen to capture. Absent = full primary display.
 *
 * Coordinates are PHYSICAL device pixels (matching the captured frame), NOT
 * logical/CSS pixels. A future region-select UI must convert from CSS pixels
 * using the display scale factor before sending, or the crop will be offset on
 * scaled (125%/150%) displays. See `scap_capturer.rs` `bgra_to_rgba` DPI caveat.
 */
export interface CaptureRegionDto {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * What to capture when no explicit display is given (F5): the monitor under
 * the cursor (default) or the active window, which falls back to the monitor
 * when it cannot be captured. Mirror of `CaptureTarget` in dto.rs.
 */
export type CaptureTargetDto = 'cursor-monitor' | 'active-window';

/** What a capture actually came from. Mirror of `CaptureSource` in dto.rs. */
export type CaptureSourceDto = 'monitor' | 'window';

export interface CaptureRequestDto {
  /** Optional sub-region; omit for full screen. */
  readonly region?: CaptureRegionDto;
  /** Target display index. */
  readonly displayIndex?: number;
  /**
   * Target display by OS device name. With neither this nor `displayIndex`,
   * native captures the monitor under the mouse cursor (P0).
   */
  readonly displayName?: string;
  /** Monitor under the cursor (default) or the active window (F5). */
  readonly target?: CaptureTargetDto;
}

export interface CaptureResultDto {
  /** PNG bytes, base64-encoded (kept simple for the IPC boundary). */
  readonly imageBase64: string;
  readonly width: number;
  readonly height: number;
  /** Unix epoch milliseconds, UTC. */
  readonly capturedAt: number;
  /** A whole monitor, or one window; an active-window request that fell back reports `monitor`. */
  readonly source: CaptureSourceDto;
}

export interface OcrRequestDto {
  readonly imageBase64: string;
  /** BCP-47 hints, e.g. ["en", "ru"]. */
  readonly languages?: readonly string[];
}

export interface OcrBoxDto {
  readonly text: string;
  readonly confidence: number;
  readonly box: CaptureRegionDto;
}

export interface OcrResultDto {
  readonly fullText: string;
  readonly boxes: readonly OcrBoxDto[];
}

// --- LLM streaming (secure-native, `llm_stream`) ---------------------------
// The webview assembles the request (model slug via ResilientLlm + messages) and
// hands it to native, which owns the key and the HTTP call. Chunks come back
// over a Tauri Channel<LlmChunkDto>. Mirror of the LlmPort shapes, kept as DTOs
// because they cross the seam. See architecture.md §3, §6.

export interface LlmTextPartDto {
  readonly kind: 'text';
  readonly text: string;
}
export interface LlmImagePartDto {
  readonly kind: 'image';
  /** base64 PNG. */
  readonly imageBase64: string;
}
export type LlmContentPartDto = LlmTextPartDto | LlmImagePartDto;

export interface LlmMessageDto {
  readonly role: 'system' | 'user' | 'assistant';
  readonly parts: readonly LlmContentPartDto[];
  /** Prompt-cache breakpoint after this message; omitted = none. */
  readonly cache?: boolean;
}

export interface LlmStreamRequestDto {
  /** OpenRouter model slug chosen by the resilient LLM layer (webview side). */
  readonly model: string;
  readonly messages: readonly LlmMessageDto[];
  /** Sampling temperature; omitted = not sent to the provider (R16). */
  readonly temperature?: number;
  /** OpenRouter `reasoning.effort` ('low'|'medium'|'high'); omitted = no reasoning (R16). */
  readonly reasoningEffort?: string;
  /** Longest image edge in px; native downscales larger images before sending (R4/R17). */
  readonly maxImageEdge?: number;
  /** Client-generated id so `llm_cancel` can stop this request. */
  readonly requestId?: string;
}

export interface LlmCancelRequestDto {
  readonly requestId: string;
}

export interface LlmUsageDto {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** USD cost reported by OpenRouter (`usage.cost`), when present. */
  readonly cost?: number;
  /** Input tokens served from the prompt cache (`prompt_tokens_details.cached_tokens`). */
  readonly cachedTokens?: number;
}

/** Discriminated union streamed over the Channel; terminal chunk is finish|error. */
export type LlmChunkDto =
  | { readonly type: 'text-delta'; readonly delta: string }
  | {
      readonly type: 'finish';
      readonly reason: string;
      readonly usage?: LlmUsageDto;
      /** Model slug the provider reports as having served the request (R19). */
      readonly model?: string;
    }
  // `retryable` tells the webview whether to fail over to the next model in the
  // chain (transient/provider-side error) or surface the failure as-is (missing
  // key, auth, bad request). Mirrors `LlmChunk::Error.retryable` in dto.rs.
  | { readonly type: 'error'; readonly message: string; readonly retryable: boolean };

// --- Secrets (write-only from the webview) ---------------------------------
// There is deliberately no DTO that carries a secret value back to the webview
// (architecture.md §11). Mirror of `SecretKeyRequest`/`SecretHasResult`/
// `SecretSetRequest` in dto.rs.
export interface SecretKeyRequestDto {
  readonly key: string;
}
export interface SecretHasResultDto {
  /** A non-empty value is stored under the key. */
  readonly exists: boolean;
}
export interface SecretSetRequestDto {
  readonly key: string;
  readonly value: string;
}

// --- Audio → STT (secure-native, phase 9) ----------------------------------
// `audioStartCapture`/`audioStopCapture` take no payload. `transcribeAudio`
// returns this. The recorded audio stays in native; only the text crosses the
// seam. Mirror of `TranscribeResult` in dto.rs.
/** Result of `audioStartCapture`: the recording keeps only the LAST `maxSeconds`. */
export interface AudioStartResultDto {
  readonly maxSeconds: number;
}

export interface TranscribeResultDto {
  /** Recognized transcript (may be empty if nothing was captured). */
  readonly text: string;
}

// --- Tray (F1, 2026-10) ------------------------------------------------------
/**
 * Payload of the `tray://action` event (native → webview): a tray-menu action
 * the webview carries out (`TrayAction` in tray.port.ts). Mirror of
 * `TrayActionPayload` in dto.rs.
 */
export interface TrayActionPayloadDto {
  readonly action: string;
}

// --- Diagnostics (2026-10 review §5.5) --------------------------------------
/** Result of `diagnosticsSnapshot`. Mirror of `DiagnosticsSnapshot` in dto.rs. */
export interface DiagnosticsSnapshotDto {
  readonly appVersion: string;
  readonly os: string;
  readonly arch: string;
  /** Where the native log file lives. */
  readonly logPath: string;
  /** The last lines of that file (never secrets/prompts/transcripts). */
  readonly logTail: string;
}
