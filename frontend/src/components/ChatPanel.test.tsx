import { render, screen, fireEvent, act } from '@testing-library/react';
import { toast } from 'sonner';
import ChatPanel from '@/components/ChatPanel';
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
});
