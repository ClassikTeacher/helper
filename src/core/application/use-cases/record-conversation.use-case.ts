import type { ConversationRepository } from '@/core/application/ports/conversation.repository';
import type { Conversation } from '@/core/domain/conversation';
import { createMessage } from '@/core/domain/message';

/** Max length of the derived conversation title. */
const TITLE_MAX = 60;

export interface RecordConversationParams {
  readonly prompt: string;
  readonly answer: string;
}

/** Injectable clock/id source so the use-case is deterministic in tests. */
export interface RecordConversationDeps {
  readonly newId?: () => string;
  readonly now?: () => number;
}

/**
 * Use-case: persist a completed prompt→answer exchange as a conversation
 * (two messages: the user's prompt and the assistant's answer). Each exchange
 * is its own conversation for now — threading/continuation is a later concern.
 */
export class RecordConversationUseCase {
  private readonly newId: () => string;
  private readonly now: () => number;

  constructor(
    private readonly conversations: ConversationRepository,
    deps: RecordConversationDeps = {},
  ) {
    this.newId = deps.newId ?? (() => crypto.randomUUID());
    this.now = deps.now ?? (() => Date.now());
  }

  async execute(params: RecordConversationParams): Promise<void> {
    const createdAt = this.now();
    const conversationId = this.newId();

    const conversation: Conversation = {
      id: conversationId,
      title: toTitle(params.prompt),
      createdAt,
      messages: [
        createMessage({
          id: this.newId(),
          conversationId,
          role: 'user',
          content: params.prompt,
          now: createdAt,
        }),
        createMessage({
          id: this.newId(),
          conversationId,
          role: 'assistant',
          content: params.answer,
          // +1ms so the assistant message sorts strictly after the prompt.
          now: createdAt + 1,
        }),
      ],
    };

    await this.conversations.save(conversation);
  }
}

/** First line of the prompt, collapsed and truncated, as a human-readable title. */
function toTitle(prompt: string): string {
  const collapsed = prompt.trim().replace(/\s+/g, ' ');
  if (collapsed.length <= TITLE_MAX) return collapsed || 'Untitled';
  return `${collapsed.slice(0, TITLE_MAX - 1)}…`;
}
