/**
 * IPC DTOs — the data shapes crossing the webview <-> Rust-core seam.
 *
 * These MUST stay in sync with `src-tauri/src/dto.rs` (serde structs).
 * This file is the single source of truth for the TS side of the contract.
 * Changing a shape here is a contract change — version it deliberately.
 *
 * See architecture.md §3 "IPC-контракт".
 */

/** Region of the screen to capture. Absent = full primary display. */
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
// The webview assembles the request (model slug via ModelRouter + messages) and
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
  /** OpenRouter model slug chosen by ModelRouter (webview side). */
  readonly model: string;
  readonly messages: readonly LlmMessageDto[];
}

export interface LlmUsageDto {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** Discriminated union streamed over the Channel; terminal chunk is finish|error. */
export type LlmChunkDto =
  | { readonly type: 'text-delta'; readonly delta: string }
  | { readonly type: 'finish'; readonly reason: string; readonly usage?: LlmUsageDto }
  | { readonly type: 'error'; readonly message: string };

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
