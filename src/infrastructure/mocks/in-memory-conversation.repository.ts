import type { ConversationRepository } from '@/core/application/ports/conversation.repository';
import type { Conversation } from '@/core/domain/conversation';

/**
 * In-memory ConversationRepository for tests and browser-only dev.
 */
export class InMemoryConversationRepository implements ConversationRepository {
  private readonly store = new Map<string, Conversation>();

  async save(conversation: Conversation): Promise<void> {
    this.store.set(conversation.id, conversation);
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
