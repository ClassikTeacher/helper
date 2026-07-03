import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeSqliteStorageAdapter } from '../helpers/node-sqlite-storage';
import { applyMigrations } from '@/infrastructure/persistence/migrations';
import { SqliteConversationRepository } from '@/infrastructure/persistence/sqlite-conversation.repository';
import type { Conversation } from '@/core/domain/conversation';

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  const id = overrides.id ?? 'c1';
  return {
    id,
    title: 'Title',
    createdAt: 1000,
    messages: [
      { id: `${id}-m1`, conversationId: id, role: 'user', content: 'hi', createdAt: 1000 },
      { id: `${id}-m2`, conversationId: id, role: 'assistant', content: 'hello', createdAt: 1001 },
    ],
    ...overrides,
  };
}

describe('SqliteConversationRepository', () => {
  let storage: NodeSqliteStorageAdapter;
  let repo: SqliteConversationRepository;

  beforeEach(async () => {
    storage = await NodeSqliteStorageAdapter.create();
    await applyMigrations(storage);
    repo = new SqliteConversationRepository(storage);
  });

  afterEach(() => storage.close());

  it('saves and reads back a conversation with its messages in order', async () => {
    await repo.save(conversation());

    const found = await repo.findById('c1');
    expect(found?.title).toBe('Title');
    expect(found?.createdAt).toBe(1000);
    expect(found?.messages.map((m) => m.content)).toEqual(['hi', 'hello']);
    expect(found?.messages[0]?.role).toBe('user');
  });

  it('returns null for a missing conversation', async () => {
    expect(await repo.findById('nope')).toBeNull();
  });

  it('lists conversations newest-first', async () => {
    await repo.save(conversation({ id: 'a', createdAt: 1 }));
    await repo.save(conversation({ id: 'b', createdAt: 3 }));
    await repo.save(conversation({ id: 'c', createdAt: 2 }));

    const list = await repo.list();
    expect(list.map((c) => c.id)).toEqual(['b', 'c', 'a']);
  });

  it('upserts the title and does not duplicate messages on re-save', async () => {
    await repo.save(conversation());
    await repo.save(conversation({ title: 'Updated' }));

    const found = await repo.findById('c1');
    expect(found?.title).toBe('Updated');
    expect(found?.messages).toHaveLength(2); // ON CONFLICT DO NOTHING on messages
  });
});
