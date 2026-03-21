import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RewriteTab from '@/components/RewriteTab';
import type { AppShellContext } from '@/layouts/AppShell';
import type { ChatMessage, SavedModel } from '@/types';

// Mock react-router-dom: provide useOutletContext
const mockOutletContext: Partial<AppShellContext> = {};
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useOutletContext: () => mockOutletContext };
});

// Mock api module
vi.mock('@/api', () => ({
  default: {
    parseStream: vi.fn(),
    listSongs: vi.fn().mockResolvedValue([]),
  },
  STORAGE_KEYS: {
    DRAFT_INPUT: 'test_draft_input',
    DRAFT_INSTRUCTION: 'test_draft_instruction',
    SPLIT_PERCENT: 'test_split_pct',
    CURRENT_SONG_ID: 'test_current_song_id',
    HAS_REWRITTEN: 'test_has_rewritten',
  },
}));

// Mock heavy child components to isolate RewriteTab layout tests
vi.mock('@/components/ChatPanel', () => ({
  default: ({ headerRight }: { headerRight?: React.ReactNode }) => (
    <div data-testid="chat-panel">{headerRight}</div>
  ),
}));
vi.mock('@/components/ComparisonView', () => ({ default: () => <div data-testid="comparison-view" /> }));
vi.mock('@/components/ui/resizable-columns', () => ({
  default: ({ className, left, right }: { className?: string; left?: React.ReactNode; right?: React.ReactNode }) => (
    <div data-testid="resizable-columns" className={className}>
      {left}
      {right}
    </div>
  ),
}));

import api, { STORAGE_KEYS } from '@/api';

function makeProps(overrides: Partial<AppShellContext> = {}): AppShellContext {
  return {
    profile: { id: 1, user_id: 'u1', display_name: 'Test', parse_prompt: '', chat_prompt: '' },
    llmSettings: { provider: 'openai', model: 'gpt-4o', reasoning_effort: 'high' },
    rewriteResult: null,
    rewriteMeta: null,
    currentSongId: null,
    chatMessages: [] as ChatMessage[],
    setChatMessages: vi.fn(),
    onNewRewrite: vi.fn(),
    onSongSaved: vi.fn(),
    onContentUpdated: vi.fn(),
    onChangeProvider: vi.fn(),
    onChangeModel: vi.fn(),
    reasoningEffort: 'high',
    onChangeReasoningEffort: vi.fn(),
    savedModels: [] as SavedModel[],
    onOpenSettings: vi.fn(),
    ...overrides,
  } as unknown as AppShellContext;
}

describe('RewriteTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('aborts in-flight parse when unmounted', async () => {
    const abortSpy = vi.fn();

    // parseStream returns a promise that never resolves (simulates in-flight stream)
    vi.mocked(api.parseStream).mockImplementation((_data, _onToken, signal) => {
      signal?.addEventListener('abort', abortSpy);
      return new Promise(() => {}); // never resolves
    });

    const props = makeProps();
    const { unmount } = render(<RewriteTab {...props} />);

    // Type some input so the Parse button is enabled
    const textarea = screen.getByPlaceholderText(/Paste your lyrics/);
    fireEvent.change(textarea, { target: { value: 'Some lyrics here' } });

    // Click Parse to start the streaming request
    const parseButton = screen.getByText('Parse');
    fireEvent.click(parseButton);

    // Verify parseStream was called
    await waitFor(() => {
      expect(api.parseStream).toHaveBeenCalledTimes(1);
    });

    // Unmount the component (simulates navigating away)
    unmount();

    // The abort signal should have fired
    expect(abortSpy).toHaveBeenCalled();
  });

  it('input card expands to fill available space with flex layout', () => {
    const props = makeProps();
    render(<RewriteTab {...props} />);

    // The Card wrapping the textareas should use flex-1 to fill space
    const lyricsTextarea = screen.getByPlaceholderText(/Paste your lyrics/);
    const card = lyricsTextarea.closest('.shadow-sm');
    expect(card).toBeTruthy();
    expect(card!.className).toContain('flex-1');
    expect(card!.className).toContain('flex-col');
    expect(card!.className).toContain('min-h-0');

    // The lyrics textarea should also grow to fill the card
    expect(lyricsTextarea.className).toContain('flex-1');
    expect(lyricsTextarea.className).toContain('min-h-0');
  });

  it('uses flex layout instead of hardcoded viewport-height offset in workshopping state', () => {
    const props = makeProps({
      rewriteResult: {
        original_content: '[C]Hello [G]World',
        rewritten_content: '[C]Hello [G]World',
        changes_summary: 'No changes',
      },
      rewriteMeta: { title: 'Test', artist: 'Test' },
      currentSongId: 1,
    });
    const { container } = render(<RewriteTab {...props} />);

    // No element should use a calc-based viewport height (the old fragile pattern)
    const allElements = container.querySelectorAll('*');
    for (const el of allElements) {
      expect(el.className).not.toMatch(/calc\(100dvh/);
    }

    // The ResizableColumns container should use flex-1 to fill remaining space
    const resizable = screen.getByTestId('resizable-columns');
    expect(resizable.className).toContain('flex-1');
  });

  it('renders Save and overflow menu in workshopping state', () => {
    const props = makeProps({
      rewriteResult: {
        original_content: '[C]Hello [G]World',
        rewritten_content: '[C]Hello [G]World',
        changes_summary: 'No changes',
      },
      rewriteMeta: { title: 'Test', artist: 'Test' },
      currentSongId: 1,
    });
    render(<RewriteTab {...props} />);

    // Save buttons render (toolbar + mobile header both present in JSDOM)
    const saveBtns = screen.getAllByRole('button', { name: 'Save' });
    expect(saveBtns.length).toBeGreaterThanOrEqual(1);

    // Overflow triggers exist
    const overflowTriggers = screen.getAllByRole('button', { name: 'More actions' });
    expect(overflowTriggers.length).toBeGreaterThanOrEqual(1);
  });

  it('shows sample song link and loads sample into parsed state on click', async () => {
    const props = makeProps();
    render(<RewriteTab {...props} />);

    // Sample link should be visible in the input state
    const sampleLink = screen.getByText('When the Saints Go Marching In');
    expect(sampleLink).toBeInTheDocument();

    // Click the sample: should skip to parsed state (chat panel + content)
    fireEvent.click(sampleLink);

    await waitFor(() => {
      expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
    });

    // The input textarea should no longer be visible (we're past the input state)
    expect(screen.queryByPlaceholderText(/Paste your lyrics/)).not.toBeInTheDocument();
  });

  it('shows "Start with a sample" above textarea for first-time users', () => {
    const props = makeProps();
    render(<RewriteTab {...props} />);

    const sampleText = screen.getByText(/Start with a sample/);
    const textarea = screen.getByPlaceholderText(/Paste your lyrics/);

    // Sample prompt should appear before the textarea in the DOM
    expect(sampleText.compareDocumentPosition(textarea) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows "Or try a sample" below textarea for returning users (localStorage)', () => {
    localStorage.setItem(STORAGE_KEYS.HAS_REWRITTEN, '1');
    const props = makeProps();
    render(<RewriteTab {...props} />);

    const sampleText = screen.getByText(/Or try a sample/);
    const textarea = screen.getByPlaceholderText(/Paste your lyrics/);

    // Sample prompt should appear after the textarea in the DOM
    expect(sampleText.compareDocumentPosition(textarea) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('shows paste-from-clipboard button when input is empty', () => {
    const props = makeProps();
    render(<RewriteTab {...props} />);

    const pasteBtn = screen.getByRole('button', { name: 'Paste from clipboard' });
    expect(pasteBtn).toBeInTheDocument();
    // Should have md:hidden class for mobile-only visibility
    expect(pasteBtn.className).toContain('md:hidden');
  });

  it('hides paste-from-clipboard button after text is entered', () => {
    const props = makeProps();
    render(<RewriteTab {...props} />);

    expect(screen.getByRole('button', { name: 'Paste from clipboard' })).toBeInTheDocument();

    const textarea = screen.getByPlaceholderText(/Paste your lyrics/);
    fireEvent.change(textarea, { target: { value: 'Some lyrics' } });

    expect(screen.queryByRole('button', { name: 'Paste from clipboard' })).not.toBeInTheDocument();
  });

  it('reads clipboard content when paste button is clicked', async () => {
    const clipboardText = '[G]Amazing [C]Grace how [D]sweet the [G]sound';
    const originalClipboard = navigator.clipboard;
    Object.assign(navigator, {
      clipboard: { readText: vi.fn().mockResolvedValue(clipboardText) },
    });

    const props = makeProps();
    render(<RewriteTab {...props} />);

    const pasteBtn = screen.getByRole('button', { name: 'Paste from clipboard' });
    fireEvent.click(pasteBtn);

    await waitFor(() => {
      const textarea = screen.getByPlaceholderText(/Paste your lyrics/) as HTMLTextAreaElement;
      expect(textarea.value).toBe(clipboardText);
    });

    // Button should disappear after pasting
    expect(screen.queryByRole('button', { name: 'Paste from clipboard' })).not.toBeInTheDocument();

    Object.assign(navigator, { clipboard: originalClipboard });
  });

  it('silently handles clipboard access denial', async () => {
    const originalClipboard = navigator.clipboard;
    Object.assign(navigator, {
      clipboard: { readText: vi.fn().mockRejectedValue(new DOMException('Denied')) },
    });

    const props = makeProps();
    render(<RewriteTab {...props} />);

    const pasteBtn = screen.getByRole('button', { name: 'Paste from clipboard' });
    fireEvent.click(pasteBtn);

    // Should not throw; button should still be visible (input still empty)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Paste from clipboard' })).toBeInTheDocument();
    });

    Object.assign(navigator, { clipboard: originalClipboard });
  });

  it('shows "Or try a sample" when server reports existing songs (cross-browser)', async () => {
    // No localStorage set, but the server returns songs for this profile
    vi.mocked(api.listSongs).mockResolvedValueOnce([{ id: 1 }] as never);
    const props = makeProps();
    render(<RewriteTab {...props} />);

    // After the async listSongs resolves, the UI should switch to returning-user mode
    await waitFor(() => {
      expect(screen.getByText(/Or try a sample/)).toBeInTheDocument();
    });

    const sampleText = screen.getByText(/Or try a sample/);
    const textarea = screen.getByPlaceholderText(/Paste your lyrics/);
    expect(sampleText.compareDocumentPosition(textarea) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });
});
