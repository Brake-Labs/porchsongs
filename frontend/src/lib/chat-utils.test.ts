import { chatHistoryToMessages, sumTokenUsage } from '@/lib/chat-utils';
import type { ChatHistoryRow, ChatMessage } from '@/types';

describe('chatHistoryToMessages', () => {
  it('passes through token usage from assistant rows', () => {
    const rows: ChatHistoryRow[] = [
      { id: 1, song_id: 1, role: 'user', content: 'Edit this', is_note: false, reasoning: null, model: null, input_tokens: null, output_tokens: null, created_at: '2026-01-01T00:00:00Z' },
      { id: 2, song_id: 1, role: 'assistant', content: 'Done!', is_note: false, reasoning: null, model: 'gpt-4o', input_tokens: 100, output_tokens: 200, created_at: '2026-01-01T00:00:01Z' },
    ];

    const messages = chatHistoryToMessages(rows);
    expect(messages[0]!.input_tokens).toBeUndefined();
    expect(messages[0]!.output_tokens).toBeUndefined();
    expect(messages[1]!.input_tokens).toBe(100);
    expect(messages[1]!.output_tokens).toBe(200);
  });

  it('handles null token values gracefully', () => {
    const rows: ChatHistoryRow[] = [
      { id: 1, song_id: 1, role: 'assistant', content: 'Old message', is_note: false, reasoning: null, model: null, input_tokens: null, output_tokens: null, created_at: '2026-01-01T00:00:00Z' },
    ];

    const messages = chatHistoryToMessages(rows);
    expect(messages[0]!.input_tokens).toBeUndefined();
    expect(messages[0]!.output_tokens).toBeUndefined();
  });
});

describe('sumTokenUsage', () => {
  it('sums token usage across multiple messages', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Edit 1' },
      { role: 'assistant', content: 'Done 1', input_tokens: 100, output_tokens: 200 },
      { role: 'user', content: 'Edit 2' },
      { role: 'assistant', content: 'Done 2', input_tokens: 150, output_tokens: 300 },
    ];

    const total = sumTokenUsage(messages);
    expect(total.input_tokens).toBe(250);
    expect(total.output_tokens).toBe(500);
  });

  it('returns zero for empty messages', () => {
    expect(sumTokenUsage([])).toEqual({ input_tokens: 0, output_tokens: 0 });
  });

  it('handles messages without token data', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ];

    const total = sumTokenUsage(messages);
    expect(total.input_tokens).toBe(0);
    expect(total.output_tokens).toBe(0);
  });
});
