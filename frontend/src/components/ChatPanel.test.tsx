import { render, screen, fireEvent, act } from '@testing-library/react';
import { toast } from 'sonner';
import ChatPanel from '@/components/ChatPanel';
import type { ChatMessage } from '@/types';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

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
    expect(screen.getByPlaceholderText(/Tell the AI/)).toBeInTheDocument();
    expect(screen.getByText('Send')).toBeInTheDocument();
  });

  it('disables input and send when initialLoading', () => {
    render(<ChatPanel {...defaults} initialLoading={true} />);
    expect(screen.getByPlaceholderText(/Tell the AI/)).toBeDisabled();
    expect(screen.getByText('Send')).toBeDisabled();
    expect(screen.getByText('Parsing song...')).toBeInTheDocument();
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
    const inputRow = screen.getByPlaceholderText(/Tell the AI/).closest('div')!;

    fireEvent.dragEnter(inputRow, { dataTransfer: { types: ['Files'], files: [] } });

    expect(screen.getByPlaceholderText(/Drop image here/)).toBeInTheDocument();
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

  it('auto-scrolls via scrollTop instead of scrollIntoView', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ];
    const { container } = render(<ChatPanel {...defaults} messages={messages} />);
    // The scroll container should exist and not contain a messagesEnd sentinel div
    const scrollContainer = container.querySelector('.overflow-y-auto');
    expect(scrollContainer).toBeInTheDocument();
    // Verify no scrollIntoView sentinel element (the old messagesEndRef div)
    const lastChild = scrollContainer!.lastElementChild;
    expect(lastChild).not.toBeEmptyDOMElement();
  });

  it('rejects images larger than 5 MB with a toast error', async () => {
    render(<ChatPanel {...defaults} />);
    const input = screen.getByPlaceholderText(/Tell the AI/);
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
});
