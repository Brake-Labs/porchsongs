import { render, screen, fireEvent, act } from '@testing-library/react';
import { toast } from 'sonner';
import ChatPanel from '@/components/ChatPanel';
import api from '@/api';
import type { ChatMessage } from '@/types';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

// jsdom doesn't implement scrollTo
Element.prototype.scrollTo = vi.fn();

describe('ChatPanel', () => {
  const defaults = {
    songId: 1,
    messages: [] as ChatMessage[],
    setMessages: vi.fn(),
    llmSettings: { provider: 'openai', model: 'gpt-4o', reasoning_effort: 'high' },
    onContentUpdated: vi.fn(),
    initialLoading: false,
  };

  it('renders the Chat Workshop header', () => {
    render(<ChatPanel {...defaults} />);
    expect(screen.getByText('Chat Workshop')).toBeInTheDocument();
  });

  it('renders the input and send button', () => {
    render(<ChatPanel {...defaults} />);
    expect(screen.getByPlaceholderText(/How would you like to change/)).toBeInTheDocument();
    expect(screen.getByText('Send')).toBeInTheDocument();
  });

  it('disables input and send when initialLoading', () => {
    render(<ChatPanel {...defaults} initialLoading={true} />);
    expect(screen.getByPlaceholderText(/How would you like to change/)).toBeDisabled();
    expect(screen.getByText('Send')).toBeDisabled();
    expect(screen.getByText('Importing song...')).toBeInTheDocument();
  });

  it('renders chat messages', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Make it about dogs' },
      { role: 'assistant', content: 'Changed truck to retriever' },
    ];
    render(<ChatPanel {...defaults} messages={messages} />);
    expect(screen.getByText('Make it about dogs')).toBeInTheDocument();
    expect(screen.getByText('Changed truck to retriever')).toBeInTheDocument();
  });

  it('renders note-style messages differently', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Pasted lyrics...', isNote: true },
    ];
    render(<ChatPanel {...defaults} messages={messages} />);
    expect(screen.getByText('Pasted lyrics...')).toBeInTheDocument();
  });

  it('renders image thumbnails in user message bubbles', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Check this chord chart', images: ['data:image/png;base64,abc123'] },
    ];
    render(<ChatPanel {...defaults} messages={messages} />);
    const img = screen.getByAltText('Attached');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'data:image/png;base64,abc123');
  });

  it('shows drag-over visual indicator when dragging files', () => {
    render(<ChatPanel {...defaults} />);
    const inputRow = screen.getByPlaceholderText(/How would you like to change/).closest('div')!;

    fireEvent.dragEnter(inputRow, { dataTransfer: { types: ['Files'], files: [] } });

    expect(screen.getByPlaceholderText(/Drop file here/)).toBeInTheDocument();
  });

  it('renders multiple image thumbnails on a single message', () => {
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: 'Two images',
        images: ['data:image/png;base64,img1', 'data:image/jpeg;base64,img2'],
      },
    ];
    render(<ChatPanel {...defaults} messages={messages} />);
    const imgs = screen.getAllByAltText('Attached');
    expect(imgs).toHaveLength(2);
  });

  it('uses scrollTo instead of scrollIntoView for iOS compatibility', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ];
    const { container } = render(<ChatPanel {...defaults} messages={messages} />);
    const scrollContainer = container.querySelector('.overflow-y-auto');
    expect(scrollContainer).toBeInTheDocument();
    expect(scrollContainer!.scrollTo).toHaveBeenCalledWith({ top: expect.any(Number), behavior: 'smooth' });
  });

  it('uses a textarea for the chat input so text wraps vertically', () => {
    render(<ChatPanel {...defaults} />);
    const input = screen.getByPlaceholderText(/How would you like to change/);
    expect(input.tagName).toBe('TEXTAREA');
  });

  it('keeps focus on chat input after sending a message', async () => {
    render(<ChatPanel {...defaults} />);
    const input = screen.getByPlaceholderText(/How would you like to change/) as HTMLTextAreaElement;

    // Focus the input and type a message
    input.focus();
    fireEvent.change(input, { target: { value: 'Make it jazzy' } });

    // Send via Enter key
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    });

    // Input should be cleared and still focused
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
  });

  it('rejects images larger than 5 MB with a toast error', async () => {
    render(<ChatPanel {...defaults} />);
    const input = screen.getByPlaceholderText(/How would you like to change/);
    const dropZone = input.closest('div')!;

    const largeFile = new File(['x'.repeat(6 * 1024 * 1024)], 'huge.png', { type: 'image/png' });
    Object.defineProperty(largeFile, 'size', { value: 6 * 1024 * 1024 });

    await act(async () => {
      fireEvent.drop(dropZone, {
        dataTransfer: { files: [largeFile] },
      });
    });

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('too large'));
  });

  describe('file attachments', () => {
    it('renders attach button with correct aria-label', () => {
      render(<ChatPanel {...defaults} />);
      const attachBtn = screen.getByRole('button', { name: 'Attach file' });
      expect(attachBtn).toBeInTheDocument();
    });

    it('hidden file input has correct accept attribute', () => {
      const { container } = render(<ChatPanel {...defaults} />);
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
      expect(fileInput).toBeInTheDocument();
      expect(fileInput.accept).toBe('image/*,.pdf,.txt,text/plain,application/pdf');
      expect(fileInput.className).toContain('hidden');
    });

    it('attach button click triggers file input click', () => {
      const { container } = render(<ChatPanel {...defaults} />);
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
      const clickSpy = vi.spyOn(fileInput, 'click');

      const attachBtn = screen.getByRole('button', { name: 'Attach file' });
      fireEvent.click(attachBtn);

      expect(clickSpy).toHaveBeenCalled();
      clickSpy.mockRestore();
    });

    it('send button is disabled when no input and no attachments', () => {
      render(<ChatPanel {...defaults} />);
      const sendBtn = screen.getByRole('button', { name: 'Send' });
      expect(sendBtn).toBeDisabled();
    });

    it('attach button is disabled when initialLoading is true', () => {
      render(<ChatPanel {...defaults} initialLoading={true} />);
      const attachBtn = screen.getByRole('button', { name: 'Attach file' });
      expect(attachBtn).toBeDisabled();
    });
  });

  it('does not truncate messages regardless of count (issue #215)', () => {
    const messages: ChatMessage[] = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `Message ${i + 1}`,
    }));
    render(<ChatPanel {...defaults} messages={messages} />);
    // All 30 messages should be rendered without truncation
    expect(screen.getByText('Message 1')).toBeInTheDocument();
    expect(screen.getByText('Message 30')).toBeInTheDocument();
    // No warning banner about message limits
    expect(screen.queryByText(/limit reached/i)).not.toBeInTheDocument();
  });

  describe('message queue (issue #214)', () => {
    // Mock chatStream to hang (never resolve) so sending state stays true
    beforeEach(() => {
      vi.spyOn(api, 'chatStream').mockReturnValue(new Promise(() => {}) as ReturnType<typeof api.chatStream>);
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('textarea stays enabled while sending', async () => {
      render(<ChatPanel {...defaults} />);
      const input = screen.getByPlaceholderText(/How would you like to change/) as HTMLTextAreaElement;

      // Type and send a message to put component in sending state
      fireEvent.change(input, { target: { value: 'First request' } });
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
      });

      // Input should NOT be disabled while LLM is processing
      expect(input).not.toBeDisabled();
    });

    it('shows Send button alongside Cancel while sending', async () => {
      render(<ChatPanel {...defaults} />);
      const input = screen.getByPlaceholderText(/How would you like to change/) as HTMLTextAreaElement;

      fireEvent.change(input, { target: { value: 'First request' } });
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
      });

      // Both Cancel and Send buttons should be visible
      expect(screen.getByText('Cancel')).toBeInTheDocument();
      expect(screen.getByText('Send')).toBeInTheDocument();
    });

    it('queues a second message while sending and marks it as pending', async () => {
      const setMessages = vi.fn();
      render(<ChatPanel {...defaults} setMessages={setMessages} />);
      const input = screen.getByPlaceholderText(/How would you like to change/) as HTMLTextAreaElement;

      // Send first message
      fireEvent.change(input, { target: { value: 'First request' } });
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
      });

      // Send second message while first is in flight
      fireEvent.change(input, { target: { value: 'Second request' } });
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
      });

      // Second message should be added with pending: true
      const pendingCall = setMessages.mock.calls.find(call => {
        if (typeof call[0] === 'function') {
          const result = call[0]([]);
          return result.some((m: ChatMessage) => m.pending === true && m.content === 'Second request');
        }
        return false;
      });
      expect(pendingCall).toBeDefined();
    });

    it('renders pending messages with Queued label', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'First request' },
        { role: 'user', content: 'Queued request', pending: true },
      ];
      render(<ChatPanel {...defaults} messages={messages} />);
      expect(screen.getByText('Queued')).toBeInTheDocument();
    });

    it('pending messages have reduced opacity', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Queued request', pending: true },
      ];
      const { container } = render(<ChatPanel {...defaults} messages={messages} />);
      const bubble = container.querySelector('.opacity-60');
      expect(bubble).toBeInTheDocument();
      expect(bubble!.textContent).toContain('Queued request');
    });

    it('clears queue and pending messages when onBeforeSend fails', async () => {
      const setMessages = vi.fn();
      const onBeforeSend = vi.fn().mockRejectedValue(new Error('Song creation failed'));
      render(
        <ChatPanel
          {...defaults}
          songId={undefined as unknown as number}
          setMessages={setMessages}
          onBeforeSend={onBeforeSend}
        />,
      );
      const input = screen.getByPlaceholderText(/How would you like to change/) as HTMLTextAreaElement;

      // Send first message (triggers onBeforeSend which will fail)
      fireEvent.change(input, { target: { value: 'First request' } });
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
      });

      // The error message should be added and pending messages filtered out
      const errorCall = setMessages.mock.calls.find(call => {
        if (typeof call[0] === 'function') {
          const result = call[0]([{ role: 'user', content: 'Queued', pending: true }]);
          return result.some((m: ChatMessage) => m.content.includes('Song creation failed')) &&
                 !result.some((m: ChatMessage) => m.pending === true);
        }
        return false;
      });
      expect(errorCall).toBeDefined();
    });

    it('clears input after queuing a message', async () => {
      render(<ChatPanel {...defaults} />);
      const input = screen.getByPlaceholderText(/How would you like to change/) as HTMLTextAreaElement;

      // Send first message
      fireEvent.change(input, { target: { value: 'First request' } });
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
      });

      // Queue second message
      fireEvent.change(input, { target: { value: 'Second request' } });
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
      });

      // Input should be cleared after queuing
      expect(input.value).toBe('');
    });
  });

  describe('rewrittenContent propagation (issue #221)', () => {
    let chatStreamSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      chatStreamSpy = vi.spyOn(api, 'chatStream').mockReturnValue(new Promise(() => {}) as ReturnType<typeof api.chatStream>);
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('sends rewritten_content in the API payload when provided', async () => {
      const editedContent = 'G Am\nEdited lyrics';
      render(<ChatPanel {...defaults} rewrittenContent={editedContent} />);
      const input = screen.getByPlaceholderText(/How would you like to change/) as HTMLTextAreaElement;

      fireEvent.change(input, { target: { value: 'make it sadder' } });
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
      });

      expect(chatStreamSpy).toHaveBeenCalledTimes(1);
      const payload = chatStreamSpy.mock.calls[0]![0] as Record<string, unknown>;
      expect(payload).toHaveProperty('rewritten_content');
      expect(payload['rewritten_content']).toBe(editedContent);
    });

    it('omits rewritten_content from payload when not provided', async () => {
      render(<ChatPanel {...defaults} />);
      const input = screen.getByPlaceholderText(/How would you like to change/) as HTMLTextAreaElement;

      fireEvent.change(input, { target: { value: 'make it sadder' } });
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
      });

      expect(chatStreamSpy).toHaveBeenCalledTimes(1);
      const payload = chatStreamSpy.mock.calls[0]![0] as Record<string, unknown>;
      expect(payload).not.toHaveProperty('rewritten_content');
    });
  });

  describe('connection lost recovery', () => {
    it('shows background processing note on ConnectionLostError instead of retry button', async () => {
      const { ConnectionLostError } = await import('@/api');
      vi.spyOn(api, 'chatStream').mockRejectedValue(new ConnectionLostError());

      const setMessages = vi.fn();
      render(<ChatPanel {...defaults} setMessages={setMessages} />);
      const input = screen.getByPlaceholderText(/How would you like to change/) as HTMLTextAreaElement;

      fireEvent.change(input, { target: { value: 'Make it jazzy' } });
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
      });

      // Should show "Processing in background..." note, not a retry button
      const lastCall = setMessages.mock.calls[setMessages.mock.calls.length - 1]!;
      // setMessages is called with a callback; invoke it to get the resulting messages
      const result = typeof lastCall[0] === 'function' ? lastCall[0]([{ role: 'user', content: 'Make it jazzy' }]) : lastCall[0];
      const lastMsg = result[result.length - 1];
      expect(lastMsg.content).toBe('Processing in background...');
      expect(lastMsg.isNote).toBe(true);
      // Retry button should NOT be shown (no Error: prefix)
      expect(lastMsg.content).not.toMatch(/^Error:/);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });
  });

  it('restores accumulated token usage from loaded messages', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Edit 1' },
      { role: 'assistant', content: 'Done 1', input_tokens: 100, output_tokens: 200 },
      { role: 'user', content: 'Edit 2' },
      { role: 'assistant', content: 'Done 2', input_tokens: 150, output_tokens: 300 },
    ];
    render(<ChatPanel {...defaults} messages={messages} />);

    // UsageFooter should display the accumulated totals (250 in / 500 out)
    expect(screen.getByText(/250/)).toBeInTheDocument();
    expect(screen.getByText(/500/)).toBeInTheDocument();
  });
});
