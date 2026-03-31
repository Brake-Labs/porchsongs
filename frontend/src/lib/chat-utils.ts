import { stripXmlTags } from '@/lib/utils';
import type { ChatMessage, ChatHistoryRow } from '@/types';

export function chatHistoryToMessages(rows: ChatHistoryRow[]): ChatMessage[] {
  return rows.map(row => {
    const role = row.role as 'user' | 'assistant';
    if (role === 'assistant' && !row.is_note) {
      const stripped = stripXmlTags(row.content);
      const hadXml = stripped !== row.content;
      return {
        role,
        content: hadXml ? (stripped || 'Chat edit applied.') : stripped,
        rawContent: hadXml ? row.content : undefined,
        isNote: row.is_note,
        reasoning: row.reasoning ?? undefined,
        model: row.model ?? undefined,
      };
    }
    return { role, content: row.content, isNote: row.is_note };
  });
}
