import { describe, it, expect } from 'vitest';
import { RecordConversationUseCase } from '@/core/application/use-cases/record-conversation.use-case';
import { InMemoryConversationRepository } from '@/infrastructure/mocks/in-memory-conversation.repository';

/** Deterministic incrementing id generator for assertions. */
function seqIds(): () => string {
  let n = 0;
  return () => `id-${n++}`;
}

describe('RecordConversationUseCase', () => {
  it('persists a prompt/answer exchange as a two-message conversation', async () => {
    const repo = new InMemoryConversationRepository();
    const useCase = new RecordConversationUseCase(repo, { newId: seqIds(), now: () => 5000 });

    await useCase.execute({ prompt: 'What is this?', answer: 'A cat.' });

    const convo = await repo.findById('id-0');
    expect(convo?.title).toBe('What is this?');
    expect(convo?.createdAt).toBe(5000);
    expect(convo?.messages).toEqual([
      { id: 'id-1', conversationId: 'id-0', role: 'user', content: 'What is this?', createdAt: 5000 },
      { id: 'id-2', conversationId: 'id-0', role: 'assistant', content: 'A cat.', createdAt: 5001 },
    ]);
  });

  it('truncates a long prompt into the title with an ellipsis', async () => {
    const repo = new InMemoryConversationRepository();
    const useCase = new RecordConversationUseCase(repo, { newId: seqIds(), now: () => 0 });

    await useCase.execute({ prompt: 'a'.repeat(200), answer: 'ok' });

    const convo = (await repo.list())[0];
    expect(convo?.title.length).toBeLessThanOrEqual(60);
    expect(convo?.title.endsWith('…')).toBe(true);
  });
});
