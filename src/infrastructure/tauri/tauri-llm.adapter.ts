import { Channel, invoke } from '@tauri-apps/api/core';
import { IPC_COMMANDS } from '@/core/contracts/ipc-commands';
import type {
  LlmCancelRequestDto,
  LlmChunkDto,
  LlmContentPartDto,
  LlmMessageDto,
  LlmStreamRequestDto,
} from '@/core/contracts/dto';
import type {
  LlmChunk,
  LlmContentPart,
  LlmMessage,
  LlmPort,
  LlmStreamRequest,
} from '@/core/application/ports/llm.port';

/**
 * Native adapter for LlmPort — the secure-native production path. Forwards the
 * request to the Rust `llm_stream` command over a Tauri `Channel<LlmChunkDto>`
 * and bridges it back into the `AsyncIterable<LlmChunk>` shape the rest of the
 * app depends on. The API key never enters this process: native reads it from
 * the OS keychain (see architecture.md §3, §6, §11).
 *
 * Bridging detail: `channel.onmessage` is push-based (fires whenever native
 * calls `Channel::send`), but `stream()` must be a *pull*-based async
 * generator. A small queue + wake-up promise turns the push callback into
 * something `for await` can consume as chunks arrive, without buffering the
 * whole response before yielding the first token.
 */
export class TauriLlmAdapter implements LlmPort {
  async *stream(request: LlmStreamRequest): AsyncIterable<LlmChunk> {
    // Tags the native request so an abort can stop it there too (P0): without
    // this the HTTP stream kept generating — and billing — after Stop.
    const requestId = newRequestId();
    const dtoRequest: LlmStreamRequestDto = { ...toStreamRequestDto(request), requestId };

    const pending: LlmChunkDto[] = [];
    let wake: (() => void) | undefined;
    const notify = () => wake?.();

    const channel = new Channel<LlmChunkDto>();
    channel.onmessage = (chunk) => {
      pending.push(chunk);
      notify();
    };

    let invokeSettled = false;
    let invokeError: unknown;
    invoke<void>(IPC_COMMANDS.llmStream, { request: dtoRequest, channel })
      .catch((error: unknown) => {
        invokeError = error;
      })
      .finally(() => {
        invokeSettled = true;
        notify();
      });

    // Cancellation: stop consuming immediately AND ask native to drop the
    // HTTP stream (`llm_cancel`), unless the stream already terminated. The
    // caller's `for await` just ends, with no terminal chunk.
    let aborted = request.signal?.aborted ?? false;
    let terminated = false;
    const cancelNative = () => {
      if (terminated) return;
      const payload: LlmCancelRequestDto = { requestId };
      invoke<void>(IPC_COMMANDS.llmCancel, { request: payload }).catch(() => {
        // Best effort: a failed cancel only means the request runs to its end.
      });
    };
    if (aborted) cancelNative();
    const onAbort = () => {
      aborted = true;
      cancelNative();
      notify();
    };
    request.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      while (true) {
        if (aborted) return;

        if (pending.length > 0) {
          const dto = pending.shift()!;
          const chunk = fromChunkDto(dto);
          if (chunk.type === 'finish' || chunk.type === 'error') terminated = true;
          yield chunk;
          if (terminated) return;
          continue;
        }

        if (invokeSettled) {
          terminated = true;
          if (invokeError) {
            // An invoke rejection is an IPC/command failure (not a provider
            // error) — the same call would fail for any model, so don't fail
            // over; surface it.
            yield { type: 'error', message: toErrorMessage(invokeError), retryable: false };
          }
          return;
        }

        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    } finally {
      request.signal?.removeEventListener('abort', onAbort);
    }
  }
}

function newRequestId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toStreamRequestDto(request: LlmStreamRequest): LlmStreamRequestDto {
  // `model` is optional on the port (the ResilientLlm layer fills it per
  // attempt), but native requires a concrete slug. In the wired app this is
  // always set by ResilientLlm before reaching here; guard loudly otherwise.
  if (!request.model) {
    throw new Error('TauriLlmAdapter requires a concrete model slug (set by ResilientLlm)');
  }
  return {
    model: request.model,
    messages: request.messages.map(toMessageDto),
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : {}),
    ...(request.maxImageEdge !== undefined ? { maxImageEdge: request.maxImageEdge } : {}),
  };
}

function toMessageDto(message: LlmMessage): LlmMessageDto {
  return { role: message.role, parts: message.parts.map(toContentPartDto) };
}

function toContentPartDto(part: LlmContentPart): LlmContentPartDto {
  return part.kind === 'text'
    ? { kind: 'text', text: part.text }
    : { kind: 'image', imageBase64: part.imageBase64 };
}

function fromChunkDto(dto: LlmChunkDto): LlmChunk {
  switch (dto.type) {
    case 'text-delta':
      return { type: 'text-delta', delta: dto.delta };
    case 'finish':
      return {
        type: 'finish',
        reason: dto.reason,
        ...(dto.usage ? { usage: dto.usage } : {}),
        ...(dto.model ? { model: dto.model } : {}),
      };
    case 'error':
      return { type: 'error', message: dto.message, retryable: dto.retryable };
  }
}
