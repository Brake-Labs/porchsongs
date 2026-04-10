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
        input_tokens: row.input_tokens ?? undefined,
        output_tokens: row.output_tokens ?? undefined,
      };
    }
    return { role, content: row.content, isNote: row.is_note };
  });
}

/** Sum token usage across all messages that have token data. */
export function sumTokenUsage(messages: ChatMessage[]): { input_tokens: number; output_tokens: number } {
  let input_tokens = 0;
  let output_tokens = 0;
  for (const msg of messages) {
    if (msg.input_tokens) input_tokens += msg.input_tokens;
    if (msg.output_tokens) output_tokens += msg.output_tokens;
  }
  return { input_tokens, output_tokens };
}
