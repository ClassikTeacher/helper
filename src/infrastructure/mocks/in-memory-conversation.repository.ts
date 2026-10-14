import type { ConversationRepository } from '@/core/application/ports/conversation.repository';
import type { Conversation } from '@/core/domain/conversation';

/**
 * In-memory ConversationRepository for tests and browser-only dev. Mirrors the
 * SQLite repository's semantics: `save` upserts the conversation (title only —
 * `createdAt` stays the first one) and ADDS messages it doesn't have yet, so a
 * dialog saved message by message accumulates them.
 */
export class InMemoryConversationRepository implements ConversationRepository {
  private readonly store = new Map<string, Conversation>();

  async save(conversation: Conversation): Promise<void> {
    const existing = this.store.get(conversation.id);
    if (!existing) {
      this.store.set(conversation.id, conversation);
      return;
    }
    const known = new Set(existing.messages.map((m) => m.id));
    this.store.set(conversation.id, {
      ...existing,
      title: conversation.title,
      messages: [...existing.messages, ...conversation.messages.filter((m) => !known.has(m.id))].sort(
        (a, b) => a.createdAt - b.createdAt,
      ),
    });
  }

  async findById(id: string): Promise<Conversation | null> {
    return this.store.get(id) ?? null;
  }

  async list(limit = 50): Promise<readonly Conversation[]> {
    return [...this.store.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }
}
