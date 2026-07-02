/**
 * Domain entity: a single conversation message. Pure data.
 */
export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  readonly id: string;
  readonly conversationId: string;
  readonly role: MessageRole;
  readonly content: string;
  /** Unix epoch milliseconds, UTC. */
  readonly createdAt: number;
}

export function createMessage(params: {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  now?: number;
}): Message {
  return {
    id: params.id,
    conversationId: params.conversationId,
    role: params.role,
    content: params.content,
    createdAt: params.now ?? Date.now(),
  };
}
