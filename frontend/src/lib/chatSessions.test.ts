import { ChatSessionStore, type ChatSink } from '@/lib/chatSessions';
import type { ChatMessage } from '@/types';

vi.mock('@/api', () => ({
  default: { chatStream: vi.fn() },
  ConnectionLostError: class ConnectionLostError extends Error {},
}));

import api from '@/api';

const chatStream = api.chatStream as unknown as ReturnType<typeof vi.fn>;

function makeSink() {
  let messages: ChatMessage[] = [];
  const sink: ChatSink = {
    setMessages: action => { messages = typeof action === 'function' ? action(messages) : action; },
    onContentUpdated: vi.fn(),
    llmSettings: { model: 'm', reasoning_effort: 'high' },
  };
  return { sink, messages: () => messages };
}

const RESULT = {
  rewritten_content: 'new',
  original_content: null,
  changes_summary: 'done',
  assistant_message: 'done',
  version: 2,
};

const msg = (text: string) => ({ apiContent: text, text, display: { role: 'user' as const, content: text } });

describe('ChatSessionStore', () => {
  beforeEach(() => chatStream.mockReset());

  it('drops writes for a song that is no longer active', async () => {
    let finish!: (v: typeof RESULT) => void;
    chatStream.mockReturnValue(new Promise(r => { finish = r; }));
    const store = new ChatSessionStore();
    const { sink, messages } = makeSink();
    store.setSink(sink);
    store.setActiveSong(1);

    const sent = store.send(1, msg('hi'));
    expect(store.get(1).sending).toBe(true);
    store.setActiveSong(2);
    finish(RESULT);
    await sent;

    expect(sink.onContentUpdated).not.toHaveBeenCalled();
    expect(messages()).toEqual([{ role: 'user', content: 'hi' }]);
    expect(store.get(1).sending).toBe(false);
  });

  it('moves a draft session to the song created for it', async () => {
    chatStream.mockResolvedValue(RESULT);
    const store = new ChatSessionStore();
    const { sink, messages } = makeSink();
    store.setSink(sink);

    await store.send(null, msg('hi'), async () => 42);

    expect(chatStream).toHaveBeenCalledWith(expect.objectContaining({ song_id: 42 }), expect.anything(), expect.anything(), expect.anything());
    expect(sink.onContentUpdated).toHaveBeenCalledWith('new');
    expect(messages().map(m => m.content)).toEqual(['hi', 'done']);
  });

  it('sends a queued message against the content the previous reply produced', async () => {
    let finish!: (v: typeof RESULT) => void;
    chatStream.mockReturnValueOnce(new Promise(r => { finish = r; }));
    chatStream.mockReturnValueOnce(new Promise(() => {}));
    const store = new ChatSessionStore();
    const { sink } = makeSink();
    // The sink still holds the pre-reply chart: React has not re-rendered yet.
    store.setSink({ ...sink, rewrittenContent: 'old' });
    store.setActiveSong(1);

    const first = store.send(1, msg('one'));
    void store.send(1, msg('two'));
    finish({ ...RESULT, rewritten_content: 'new' });
    await first;

    expect(chatStream).toHaveBeenCalledTimes(2);
    expect(chatStream.mock.calls[1]![0]).toMatchObject({ rewritten_content: 'new' });
  });
});
