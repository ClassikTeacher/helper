import type { Conversation } from '@/core/domain/conversation';

/**
 * Port (repository): persistence of conversations. Hides SQL from use-cases.
 */
export interface ConversationRepository {
  save(conversation: Conversation): Promise<void>;
  findById(id: string): Promise<Conversation | null>;
  list(limit?: number): Promise<readonly Conversation[]>;
}
