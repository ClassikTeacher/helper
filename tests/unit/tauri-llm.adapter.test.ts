import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LlmChunkDto } from '@/core/contracts/dto';

// The real `Channel` class calls `window.__TAURI_INTERNALS__.transformCallback`
// synchronously in its constructor — unavailable outside a real Tauri webview.
// This fake keeps the one thing the adapter relies on (`onmessage` callback,
// invoked by the test to simulate native `channel.send(...)`) without any
// Tauri runtime.
class FakeChannel<T> {
  onmessage: (payload: T) => void = () => {};
  emit(payload: T) {
    this.onmessage(payload);
  }
}

let lastChannel: FakeChannel<LlmChunkDto> | undefined;

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: class {
    constructor() {
      const channel = new FakeChannel<LlmChunkDto>();
      lastChannel = channel;
      return channel;
    }
  },
}));

import { invoke } from '@tauri-apps/api/core';
import { IPC_COMMANDS } from '@/core/contracts/ipc-commands';
import { TauriLlmAdapter } from '@/infrastructure/tauri/tauri-llm.adapter';
import type { LlmStreamRequest } from '@/core/application/ports/llm.port';

const REQUEST: LlmStreamRequest = {
  model: 'openai/gpt-4o-mini',
  messages: [{ role: 'user', parts: [{ kind: 'text', text: 'hi' }] }],
};

/** Drains an async iterable into an array, capping iterations as a safety net. */
async function collect<T>(iterable: AsyncIterable<T>, max = 20): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) {
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

describe('TauriLlmAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastChannel = undefined;
  });

  it('invokes llm_stream with the mapped DTO request and a channel', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      lastChannel!.emit({ type: 'finish', reason: 'stop' });
    });

    const adapter = new TauriLlmAdapter();
    await collect(adapter.stream(REQUEST));

    expect(invoke).toHaveBeenCalledWith(
      IPC_COMMANDS.llmStream,
      expect.objectContaining({
        request: {
          model: REQUEST.model,
          messages: [{ role: 'user', parts: [{ kind: 'text', text: 'hi' }] }],
        },
        channel: expect.anything(),
      }),
    );
  });

  it('yields text-delta chunks as they arrive, before the command resolves', async () => {
    let resolveInvoke!: () => void;
    (invoke as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise<void>((resolve) => { resolveInvoke = resolve; }),
    );

    const adapter = new TauriLlmAdapter();
    const iterator = adapter.stream(REQUEST)[Symbol.asyncIterator]();

    // The generator body (which constructs the Channel) only runs once
    // `.next()` is first called — it executes synchronously up to its first
    // suspension point, so `lastChannel` is set before this call resolves.
    const firstPending = iterator.next();
    lastChannel!.emit({ type: 'text-delta', delta: 'hel' });
    const first = await firstPending;
    expect(first.value).toEqual({ type: 'text-delta', delta: 'hel' });

    const secondPending = iterator.next();
    lastChannel!.emit({ type: 'text-delta', delta: 'lo' });
    const second = await secondPending;
    expect(second.value).toEqual({ type: 'text-delta', delta: 'lo' });

    const thirdPending = iterator.next();
    lastChannel!.emit({ type: 'finish', reason: 'stop', usage: { inputTokens: 1, outputTokens: 2 } });
    const third = await thirdPending;
    expect(third.value).toEqual({
      type: 'finish',
      reason: 'stop',
      usage: { inputTokens: 1, outputTokens: 2 },
    });

    const fourth = await iterator.next();
    expect(fourth.done).toBe(true);

    resolveInvoke();
  });

  it('stops after a terminal error chunk from native, passing retryable through', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      lastChannel!.emit({
        type: 'error',
        message: 'OpenRouter API key is not set. Add it in settings.',
        retryable: false,
      });
    });

    const adapter = new TauriLlmAdapter();
    const chunks = await collect(adapter.stream(REQUEST));

    expect(chunks).toEqual([
      { type: 'error', message: 'OpenRouter API key is not set. Add it in settings.', retryable: false },
    ]);
  });

  it('preserves a retryable error flag from native (so failover can trigger)', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      lastChannel!.emit({ type: 'error', message: 'OpenRouter HTTP 503: unavailable', retryable: true });
    });

    const adapter = new TauriLlmAdapter();
    const chunks = await collect(adapter.stream(REQUEST));

    expect(chunks).toEqual([{ type: 'error', message: 'OpenRouter HTTP 503: unavailable', retryable: true }]);
  });

  it('surfaces an invoke rejection as a non-retryable terminal error chunk', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('IPC transport failed'));

    const adapter = new TauriLlmAdapter();
    const chunks = await collect(adapter.stream(REQUEST));

    expect(chunks).toEqual([{ type: 'error', message: 'IPC transport failed', retryable: false }]);
  });

  it('stops yielding once the abort signal fires, without throwing', async () => {
    let resolveInvoke!: () => void;
    (invoke as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise<void>((resolve) => { resolveInvoke = resolve; }),
    );

    const controller = new AbortController();
    const adapter = new TauriLlmAdapter();
    const iterator = adapter.stream({ ...REQUEST, signal: controller.signal })[Symbol.asyncIterator]();

    const firstPending = iterator.next();
    lastChannel!.emit({ type: 'text-delta', delta: 'hel' });
    await firstPending;

    const secondPending = iterator.next();
    controller.abort();
    const result = await secondPending;
    expect(result.done).toBe(true);

    resolveInvoke();
  });
});
