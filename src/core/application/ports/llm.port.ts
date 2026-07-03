import type { ModelSlug } from '@/core/domain/model-route';

export interface LlmImagePart {
  readonly kind: 'image';
  /** base64 PNG. */
  readonly imageBase64: string;
}
export interface LlmTextPart {
  readonly kind: 'text';
  readonly text: string;
}
export type LlmContentPart = LlmTextPart | LlmImagePart;

export interface LlmMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly parts: readonly LlmContentPart[];
}

export interface LlmStreamRequest {
  /**
   * Target model slug. Optional because the resilient failover layer
   * (`ResilientLlm`) owns model selection and fills this in per attempt as it
   * walks the chain. Callers (use-cases) leave it unset; the native/dev
   * adapters always receive a concrete slug from `ResilientLlm`.
   */
  readonly model?: ModelSlug;
  readonly messages: readonly LlmMessage[];
  readonly signal?: AbortSignal;
}

export interface LlmUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** Incremental text token(s). */
export interface LlmTextDelta {
  readonly type: 'text-delta';
  readonly delta: string;
}
/** Terminal success: the stream completed normally. */
export interface LlmFinish {
  readonly type: 'finish';
  /** Provider finish reason, e.g. "stop" | "length" | "tool-calls". */
  readonly reason: string;
  /** Token accounting, when the provider reports it (cost/UX). */
  readonly usage?: LlmUsage;
}
/** Terminal failure: the stream aborted mid-flight. */
export interface LlmError {
  readonly type: 'error';
  readonly message: string;
  /**
   * Whether this failure is worth retrying on a DIFFERENT model — set by the
   * side that knows the true cause (native: HTTP status / network / no-key).
   * `true` for transient/provider-side failures (model unavailable, 429/5xx,
   * network); `false` for failures that would recur on every model (missing
   * API key, auth, malformed request). `ResilientLlm` consults this to decide
   * whether to fail over to the next model in the chain.
   */
  readonly retryable: boolean;
}

/**
 * A streamed unit. A well-behaved stream is zero+ `text-delta` chunks followed
 * by exactly one terminal chunk (`finish` OR `error`). Modelling the terminal
 * signal explicitly lets the UI show partial-failure and cost without relying
 * on a thrown exception as the only error channel.
 */
export type LlmChunk = LlmTextDelta | LlmFinish | LlmError;

/**
 * Port: stream a completion from an LLM provider.
 *
 * Production impl is `TauriLlmAdapter` — it forwards the request to the native
 * `llm_stream` command (Rust) over a Tauri Channel, so the API key never enters
 * the webview (see architecture.md §3, §6 "secure-native"). `FakeLlmAdapter`
 * serves tests/dev; the browser AI-SDK adapter is dev-only (exposes the key).
 */
export interface LlmPort {
  stream(request: LlmStreamRequest): AsyncIterable<LlmChunk>;
}
