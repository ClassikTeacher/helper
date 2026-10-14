import type { ConversationRepository } from '@/core/application/ports/conversation.repository';
import type { Conversation } from '@/core/domain/conversation';
import { createMessage } from '@/core/domain/message';

/** Max length of the derived conversation title. */
const TITLE_MAX = 60;

export interface RecordConversationParams {
  readonly prompt: string;
  readonly answer: string;
  /**
   * The dialog this exchange belongs to: its messages are appended to that
   * conversation. Omitted = a new conversation of its own.
   */
  readonly conversationId?: string;
  /** Conversation title; defaults to the prompt. Pass the dialog's first prompt to keep it stable. */
  readonly title?: string;
}

/** Injectable clock/id source so the use-case is deterministic in tests. */
export interface RecordConversationDeps {
  readonly newId?: () => string;
  readonly now?: () => number;
}

/**
 * Use-case: persist a completed prompt→answer exchange (two messages: the
 * user's prompt and the assistant's answer). With a `conversationId` the
 * messages are appended to that dialog's conversation (the repository upserts
 * the conversation row and inserts the new messages); without one, the
 * exchange becomes a conversation of its own.
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
    const conversationId = params.conversationId ?? this.newId();

    const conversation: Conversation = {
      id: conversationId,
      title: toTitle(params.title ?? params.prompt),
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
