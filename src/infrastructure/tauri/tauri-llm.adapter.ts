import { Channel, invoke } from '@tauri-apps/api/core';
import { IPC_COMMANDS } from '@/core/contracts/ipc-commands';
import type {
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
    const dtoRequest: LlmStreamRequestDto = toStreamRequestDto(request);

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

    // Best-effort local cancellation: there is no native cancel command yet,
    // so the `llm_stream` invocation keeps running in the background, but we
    // stop consuming/yielding further chunks — the `for await` loop on the
    // caller's side just ends, same as a normal `finish`.
    let aborted = request.signal?.aborted ?? false;
    const onAbort = () => {
      aborted = true;
      notify();
    };
    request.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      while (true) {
        if (aborted) return;

        if (pending.length > 0) {
          const dto = pending.shift()!;
          const chunk = fromChunkDto(dto);
          yield chunk;
          if (chunk.type === 'finish' || chunk.type === 'error') return;
          continue;
        }

        if (invokeSettled) {
          if (invokeError) {
            yield { type: 'error', message: toErrorMessage(invokeError) };
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

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toStreamRequestDto(request: LlmStreamRequest): LlmStreamRequestDto {
  return {
    model: request.model,
    messages: request.messages.map(toMessageDto),
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
      return { type: 'finish', reason: dto.reason, ...(dto.usage ? { usage: dto.usage } : {}) };
    case 'error':
      return { type: 'error', message: dto.message };
  }
}
