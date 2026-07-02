/**
 * Domain entity: a conversation (aggregate of messages). Pure data.
 */
import type { Message } from './message';

export interface Conversation {
  readonly id: string;
  readonly title: string;
  readonly messages: readonly Message[];
  /** Unix epoch milliseconds, UTC. */
  readonly createdAt: number;
}

/** Immutable append — returns a new conversation (see coding-style: no mutation). */
export function appendMessage(conversation: Conversation, message: Message): Conversation {
  return { ...conversation, messages: [...conversation.messages, message] };
}
