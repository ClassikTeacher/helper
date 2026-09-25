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

export interface CaptureRequestDto {
  /** Optional sub-region; omit for full screen. */
  readonly region?: CaptureRegionDto;
  /** Target display index; omit for primary. */
  readonly displayIndex?: number;
}

export interface CaptureResultDto {
  /** PNG bytes, base64-encoded (kept simple for the IPC boundary). */
  readonly imageBase64: string;
  readonly width: number;
  readonly height: number;
  /** Unix epoch milliseconds, UTC. */
  readonly capturedAt: number;
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

export interface SecretGetRequestDto {
  readonly key: string;
}
export interface SecretGetResultDto {
  readonly value: string | null;
}
export interface SecretSetRequestDto {
  readonly key: string;
  readonly value: string;
}

// --- Audio → STT (secure-native, phase 9) ----------------------------------
// `audioStartCapture`/`audioStopCapture` take no payload. `transcribeAudio`
// returns this. The recorded audio stays in native; only the text crosses the
// seam. Mirror of `TranscribeResult` in dto.rs.
export interface TranscribeResultDto {
  /** Recognized transcript (may be empty if nothing was captured). */
  readonly text: string;
}
