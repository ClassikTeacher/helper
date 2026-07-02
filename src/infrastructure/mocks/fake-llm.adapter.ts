import type { LlmChunk, LlmPort, LlmStreamRequest } from '@/core/application/ports/llm.port';

/**
 * Deterministic LlmPort for dev (browser-only `pnpm dev`) and tests.
 * Streams a canned response word-by-word so the UI streaming path is exercised
 * without any network or API key.
 */
export class FakeLlmAdapter implements LlmPort {
  constructor(private readonly response = 'This is a fake streamed response for local development.') {}

  async *stream(_request: LlmStreamRequest): AsyncIterable<LlmChunk> {
    const words = this.response.split(' ');
    for (const word of words) {
      yield { type: 'text-delta', delta: word + ' ' };
    }
    yield { type: 'finish', reason: 'stop', usage: { inputTokens: 0, outputTokens: words.length } };
  }
}
