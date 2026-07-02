import type { StoragePort } from '@/core/application/ports/storage.port';
import type { ConversationRepository } from '@/core/application/ports/conversation.repository';
import type { Conversation } from '@/core/domain/conversation';
import type { Message, MessageRole } from '@/core/domain/message';

interface ConversationRow {
  id: string;
  title: string;
  created_at: number;
}
interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: number;
}

/**
 * SQLite-backed ConversationRepository. Depends on StoragePort (not on Tauri
 * directly), so it can run against any SQL driver — including an in-memory one
 * in tests.
 */
export class SqliteConversationRepository implements ConversationRepository {
  constructor(private readonly storage: StoragePort) {}

  async save(conversation: Conversation): Promise<void> {
    await this.storage.execute(
      `INSERT INTO conversations (id, title, created_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title;`,
      [conversation.id, conversation.title, conversation.createdAt],
    );
    for (const m of conversation.messages) {
      await this.storage.execute(
        `INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING;`,
        [m.id, m.conversationId, m.role, m.content, m.createdAt],
      );
    }
  }

  async findById(id: string): Promise<Conversation | null> {
    const rows = await this.storage.query<ConversationRow>(
      `SELECT id, title, created_at FROM conversations WHERE id = ?;`,
      [id],
    );
    const head = rows[0];
    if (!head) return null;

    const messageRows = await this.storage.query<MessageRow>(
      `SELECT id, conversation_id, role, content, created_at FROM messages
       WHERE conversation_id = ? ORDER BY created_at ASC;`,
      [id],
    );
    return toConversation(head, messageRows);
  }

  async list(limit = 50): Promise<readonly Conversation[]> {
    const rows = await this.storage.query<ConversationRow>(
      `SELECT id, title, created_at FROM conversations ORDER BY created_at DESC LIMIT ?;`,
      [limit],
    );
    return rows.map((r) => toConversation(r, []));
  }
}

function toConversation(row: ConversationRow, messageRows: readonly MessageRow[]): Conversation {
  const messages: Message[] = messageRows.map((m) => ({
    id: m.id,
    conversationId: m.conversation_id,
    role: m.role as MessageRole,
    content: m.content,
    createdAt: m.created_at,
  }));
  return { id: row.id, title: row.title, createdAt: row.created_at, messages };
}
