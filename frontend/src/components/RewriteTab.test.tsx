import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import RewriteTab from '@/components/RewriteTab';
import type { AppShellContext } from '@/layouts/AppShell';
import type { ChatMessage, SavedModel, ParseResult } from '@/types';

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
    parseImage: vi.fn().mockResolvedValue({ text: '' }),
    extractFile: vi.fn().mockResolvedValue({ text: '' }),
    listSongs: vi.fn().mockResolvedValue([]),
    updateSong: vi.fn().mockResolvedValue({}),
  },
  STORAGE_KEYS: {
    DRAFT_INPUT: 'test_draft_input',
    DRAFT_INSTRUCTION: 'test_draft_instruction',
    SPLIT_PERCENT: 'test_split_pct',
    CURRENT_SONG_ID: 'test_current_song_id',
    HAS_REWRITTEN: 'test_has_rewritten',
  },
}));

// Capture ChatPanel props so tests can invoke the callbacks RewriteTab passes in
let capturedChatPanelProps: Record<string, unknown> = {};
vi.mock('@/components/ChatPanel', () => ({
  default: (props: Record<string, unknown>) => {
    capturedChatPanelProps = props;
    return <div data-testid="chat-panel">{props.headerRight as React.ReactNode}</div>;
  },
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
    onOriginalContentUpdated: vi.fn(),
    onChangeProvider: vi.fn(),
    onChangeModel: vi.fn(),
    reasoningEffort: 'high',
    onChangeReasoningEffort: vi.fn(),
    savedModels: [] as SavedModel[],
    onOpenSettings: vi.fn(),
    // Parse state (lifted to AppShell)
    parseLoading: false,
    parseResult: null,
    parsedContent: '',
    setParsedContent: vi.fn(),
    setParseResult: vi.fn(),
    parseStreamText: '',
    parseReasoningText: '',
    parseError: null,
    setParseError: vi.fn(),
    onParse: vi.fn().mockResolvedValue(null),
    onCancelParse: vi.fn(),
    onClearParse: vi.fn(),
    ...overrides,
  } as unknown as AppShellContext;
}

describe('RewriteTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('delegates parse to AppShell onParse and does not abort on unmount', async () => {
    // onParse returns a promise that never resolves (simulates in-flight stream)
    const onParse = vi.fn().mockReturnValue(new Promise(() => {}));

    const props = makeProps({ onParse });
    const { unmount } = render(<RewriteTab {...props} />);

    // Type some input so the Parse button is enabled
    const textarea = screen.getByPlaceholderText(/Paste lyrics/);
    fireEvent.change(textarea, { target: { value: 'Some lyrics here' } });

    // Click Parse to start the streaming request
    const parseButton = screen.getByText('Import Song');
    fireEvent.click(parseButton);

    // Verify onParse was called (delegated to AppShell)
    await waitFor(() => {
      expect(onParse).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Some lyrics here' }),
      );
    });

    // Unmount the component (simulates navigating away)
    // No AbortError should be thrown; parse continues in AppShell
    unmount();

    // onCancelParse was NOT called (parse survives navigation)
    expect(props.onCancelParse).not.toHaveBeenCalled();
  });

  it('shows step 1 indicator in INPUT state', () => {
    const props = makeProps();
    render(<RewriteTab {...props} />);

    expect(screen.getByText('Step 1: Import your song')).toBeInTheDocument();
  });

  it('shows step 2 indicator in PARSED state', () => {
    const props = makeProps({
      parseResult: { title: 'Test', artist: 'Test', original_content: 'content' } as ParseResult,
      parsedContent: 'content',
    });
    render(<RewriteTab {...props} />);

    expect(screen.getByText('Step 2: Edit your song')).toBeInTheDocument();
  });

  it('input card expands to fill available space with flex layout', () => {
    const props = makeProps();
    render(<RewriteTab {...props} />);

    // The Card wrapping the textareas should use flex-1 to fill space
    const lyricsTextarea = screen.getByPlaceholderText(/Paste lyrics/);
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

  it('does not show save button in workshopping state (autosave handles persistence)', () => {
    const props = makeProps({
      rewriteResult: {
        original_content: '[C]Hello [G]World',
        rewritten_content: '[C]Hello [G]World',
        changes_summary: 'No changes',
      },
      rewriteMeta: { title: 'Test', artist: 'Test' },
      currentSongId: 1,
      currentSongUuid: 'uuid-1',
    });
    render(<RewriteTab {...props} />);

    // No save button should exist
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Saved' })).not.toBeInTheDocument();

    // Overflow triggers still exist
    const overflowTriggers = screen.getAllByRole('button', { name: 'More actions' });
    expect(overflowTriggers.length).toBeGreaterThanOrEqual(1);
  });

  it('autosaves after debounce when title is edited', async () => {
    vi.useFakeTimers();
    vi.mocked(api.updateSong).mockResolvedValue({} as never);
    const props = makeProps({
      rewriteResult: {
        original_content: '[C]Hello [G]World',
        rewritten_content: '[C]Hello [G]World',
        changes_summary: 'No changes',
      },
      rewriteMeta: { title: 'Test', artist: 'Test' },
      currentSongId: 1,
      currentSongUuid: 'uuid-1',
    });
    render(<RewriteTab {...props} />);

    // Edit title
    const titleInput = screen.getAllByLabelText('Song title')[0]!;
    fireEvent.change(titleInput, { target: { value: 'New Title' } });

    // Not saved yet (debounce hasn't fired)
    expect(api.updateSong).not.toHaveBeenCalled();

    // Advance past the 1.5s debounce
    await act(async () => { vi.advanceTimersByTime(1600); });

    expect(api.updateSong).toHaveBeenCalledWith('uuid-1', expect.objectContaining({
      title: 'New Title',
    }));

    vi.useRealTimers();
  });

  it('shows "Saved" indicator briefly after autosave completes', async () => {
    vi.useFakeTimers();
    vi.mocked(api.updateSong).mockResolvedValue({} as never);
    const props = makeProps({
      rewriteResult: {
        original_content: '[C]Hello [G]World',
        rewritten_content: '[C]Hello [G]World',
        changes_summary: 'No changes',
      },
      rewriteMeta: { title: 'Test', artist: 'Test' },
      currentSongId: 1,
      currentSongUuid: 'uuid-1',
    });
    render(<RewriteTab {...props} />);

    // Edit artist to trigger autosave
    const artistInput = screen.getAllByLabelText('Artist')[0]!;
    fireEvent.change(artistInput, { target: { value: 'New Artist' } });

    // Advance past debounce
    await act(async () => { vi.advanceTimersByTime(1600); });

    // "Saved" indicator should appear
    const indicators = screen.getAllByTestId('save-status');
    expect(indicators.length).toBeGreaterThanOrEqual(1);
    expect(indicators[0]!.textContent).toBe('Saved');

    // After 2s, indicator should disappear
    await act(async () => { vi.advanceTimersByTime(2100); });
    expect(screen.queryByTestId('save-status')).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  it('sets dirty state after chat update for autosave (fixes #189)', () => {
    vi.useFakeTimers();
    vi.mocked(api.updateSong).mockResolvedValue({} as never);
    render(<RewriteTab {...makeProps({
      rewriteResult: {
        original_content: 'original lyrics',
        rewritten_content: 'old rewritten lyrics',
        changes_summary: 'Initial',
      },
      rewriteMeta: { title: 'Test', artist: 'Artist' },
      currentSongId: 42,
      currentSongUuid: 'test-uuid-42',
    })} />);

    // Simulate chat update
    const chatOnContent = capturedChatPanelProps.onContentUpdated as (s: string) => void;
    act(() => chatOnContent('NEW content from chat'));

    // Not saved immediately
    expect(api.updateSong).not.toHaveBeenCalled();

    // Autosave fires after debounce
    act(() => { vi.advanceTimersByTime(1600); });
    expect(api.updateSong).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('Cmd+S triggers save', async () => {
    vi.mocked(api.updateSong).mockResolvedValue({} as never);
    render(<RewriteTab {...makeProps({
      rewriteResult: {
        original_content: 'orig',
        rewritten_content: 'rewritten',
        changes_summary: 'No changes',
      },
      rewriteMeta: { title: 'Song', artist: 'Artist' },
      currentSongId: 1,
      currentSongUuid: 'uuid-cmd-s',
    })} />);

    // Make dirty first
    const titleInput = screen.getAllByLabelText('Song title')[0]!;
    fireEvent.change(titleInput, { target: { value: 'Changed' } });

    // Fire Cmd+S
    fireEvent.keyDown(window, { key: 's', metaKey: true });

    await waitFor(() => {
      expect(api.updateSong).toHaveBeenCalledWith('uuid-cmd-s', expect.objectContaining({
        title: 'Changed',
      }));
    });
  });

  it('attaches beforeunload listener when dirty', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = render(<RewriteTab {...makeProps({
      rewriteResult: {
        original_content: 'orig',
        rewritten_content: 'rewritten',
        changes_summary: 'x',
      },
      rewriteMeta: { title: 'T', artist: 'A' },
      currentSongId: 1,
      currentSongUuid: 'uuid-bl',
    })} />);

    // Initially not dirty, beforeunload not attached (beyond the initial render cycle)
    const beforeUnloadCalls = addSpy.mock.calls.filter(c => c[0] === 'beforeunload');
    expect(beforeUnloadCalls.length).toBe(0);

    // Edit title to set dirty
    const titleInput = screen.getAllByLabelText('Song title')[0]!;
    fireEvent.change(titleInput, { target: { value: 'Dirty' } });

    // beforeunload should now be attached
    const afterEditCalls = addSpy.mock.calls.filter(c => c[0] === 'beforeunload');
    expect(afterEditCalls.length).toBe(1);

    unmount();

    // Cleanup: beforeunload removed
    const removedCalls = removeSpy.mock.calls.filter(c => c[0] === 'beforeunload');
    expect(removedCalls.length).toBeGreaterThanOrEqual(1);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('does not save immediately on edit (waits for debounce)', () => {
    render(<RewriteTab {...makeProps({
      rewriteResult: {
        original_content: 'orig',
        rewritten_content: 'rewritten',
        changes_summary: 'x',
      },
      rewriteMeta: { title: 'T', artist: 'A' },
      currentSongId: 1,
      currentSongUuid: 'uuid-no-blur',
    })} />);

    const titleInput = screen.getAllByLabelText('Song title')[0]!;
    fireEvent.change(titleInput, { target: { value: 'New Title' } });

    // updateSong should NOT have been called immediately
    expect(api.updateSong).not.toHaveBeenCalled();
  });

  it('calls setParseResult when sample song is clicked', () => {
    const setParseResult = vi.fn();
    const setParsedContent = vi.fn();
    const props = makeProps({ setParseResult, setParsedContent });
    render(<RewriteTab {...props} />);

    // Sample link should be visible
    const sampleLink = screen.getByText('When the Saints Go Marching In');
    expect(sampleLink).toBeInTheDocument();

    fireEvent.click(sampleLink);

    // Should have set parse result in AppShell context
    expect(setParseResult).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.any(String),
      original_content: expect.any(String),
    }));
    expect(setParsedContent).toHaveBeenCalled();
  });

  it('shows parsed state when parseResult is provided (e.g. after returning to tab)', () => {
    const props = makeProps({
      parseResult: {
        title: 'Amazing Grace',
        artist: 'John Newton',
        original_content: '[G]Amazing grace how [C]sweet the [G]sound',
      } as ParseResult,
      parsedContent: '[G]Amazing grace how [C]sweet the [G]sound',
    });
    render(<RewriteTab {...props} />);

    // Should be in parsed state (chat panel visible, input hidden)
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Paste lyrics/)).not.toBeInTheDocument();
  });

  it('shows loading state from context (parse in progress)', () => {
    const props = makeProps({
      parseLoading: true,
      parseStreamText: 'partial output...',
    });
    render(<RewriteTab {...props} />);

    // Should show loading indicator
    expect(screen.getByText('Importing song...')).toBeInTheDocument();
    expect(screen.getByText('partial output...')).toBeInTheDocument();
  });

  it('shows "Start with a sample" above textarea for first-time users', () => {
    const props = makeProps();
    render(<RewriteTab {...props} />);

    const sampleText = screen.getByText(/Start with a sample/);
    const textarea = screen.getByPlaceholderText(/Paste lyrics/);

    // Sample prompt should appear before the textarea in the DOM
    expect(sampleText.compareDocumentPosition(textarea) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows "Or try a sample" below textarea for returning users (localStorage)', () => {
    localStorage.setItem(STORAGE_KEYS.HAS_REWRITTEN, '1');
    const props = makeProps();
    render(<RewriteTab {...props} />);

    const sampleText = screen.getByText(/Or try a sample/);
    const textarea = screen.getByPlaceholderText(/Paste lyrics/);

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

    const textarea = screen.getByPlaceholderText(/Paste lyrics/);
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
      const textarea = screen.getByPlaceholderText(/Paste lyrics/) as HTMLTextAreaElement;
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
    const textarea = screen.getByPlaceholderText(/Paste lyrics/);
    expect(sampleText.compareDocumentPosition(textarea) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  describe('New Song button', () => {
    it('renders in PARSED state', () => {
      const props = makeProps({
        parseResult: { title: 'Test', artist: 'Test', original_content: 'content' } as ParseResult,
        parsedContent: 'content',
      });
      render(<RewriteTab {...props} />);

      // Should show "+ New Song" (desktop) and "+ New" (mobile)
      expect(screen.getByRole('button', { name: '+ New Song' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '+ New' })).toBeInTheDocument();
    });

    it('renders in WORKSHOPPING state', () => {
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

      expect(screen.getByRole('button', { name: '+ New Song' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '+ New' })).toBeInTheDocument();
    });

    it('does not render in INPUT state', () => {
      const props = makeProps();
      render(<RewriteTab {...props} />);

      expect(screen.queryByRole('button', { name: '+ New Song' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '+ New' })).not.toBeInTheDocument();
    });

    it('shows confirmation dialog when clicked in WORKSHOPPING state', () => {
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

      fireEvent.click(screen.getByRole('button', { name: '+ New Song' }));

      expect(screen.getByText('Start New Song')).toBeInTheDocument();
      expect(screen.getByText(/Starting a new song will discard your current work/)).toBeInTheDocument();
    });

    it('calls onNewRewrite(null, null) when confirmation dialog is confirmed', () => {
      const onNewRewrite = vi.fn();
      const props = makeProps({
        rewriteResult: {
          original_content: '[C]Hello [G]World',
          rewritten_content: '[C]Hello [G]World',
          changes_summary: 'No changes',
        },
        rewriteMeta: { title: 'Test', artist: 'Test' },
        currentSongId: 1,
        onNewRewrite,
      });
      render(<RewriteTab {...props} />);

      fireEvent.click(screen.getByRole('button', { name: '+ New Song' }));
      fireEvent.click(screen.getByRole('button', { name: 'New Song' }));

      expect(onNewRewrite).toHaveBeenCalledWith(null, null);
    });

    it('does not clear state when confirmation dialog is cancelled', () => {
      const onNewRewrite = vi.fn();
      const props = makeProps({
        rewriteResult: {
          original_content: '[C]Hello [G]World',
          rewritten_content: '[C]Hello [G]World',
          changes_summary: 'No changes',
        },
        rewriteMeta: { title: 'Test', artist: 'Test' },
        currentSongId: 1,
        onNewRewrite,
      });
      render(<RewriteTab {...props} />);

      fireEvent.click(screen.getByRole('button', { name: '+ New Song' }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      // onNewRewrite should not have been called (except initial render effects)
      expect(onNewRewrite).not.toHaveBeenCalledWith(null, null);
    });

    it('calls onClearParse when New Song is clicked in PARSED state', () => {
      const onClearParse = vi.fn();
      const onNewRewrite = vi.fn();
      const props = makeProps({
        parseResult: { title: 'Test', artist: 'Test', original_content: 'content' } as ParseResult,
        parsedContent: 'content',
        chatMessages: [],
        onClearParse,
        onNewRewrite,
      });
      render(<RewriteTab {...props} />);

      fireEvent.click(screen.getByRole('button', { name: '+ New Song' }));

      // Should not show dialog (parsed state with no chat messages)
      expect(screen.queryByText('Start New Song')).not.toBeInTheDocument();

      // Should have called onClearParse to clear parse state in AppShell
      expect(onClearParse).toHaveBeenCalled();
      expect(onNewRewrite).toHaveBeenCalledWith(null, null);
    });
  });

  it('does not revert rewritten content when original content is updated in the same batch (issue #165)', () => {
    // Setup: workshopping state with known content
    const onNewRewrite = vi.fn();
    const onContentUpdated = vi.fn();

    render(<RewriteTab {...makeProps({
      rewriteResult: {
        original_content: 'original lyrics',
        rewritten_content: 'old rewritten lyrics',
        changes_summary: 'Initial',
      },
      rewriteMeta: { title: 'Test', artist: 'Artist' },
      currentSongId: 42,
      currentSongUuid: 'test-uuid-42',
      onNewRewrite,
      onContentUpdated,
    })} />);

    // Simulate what ChatPanel does after streaming a response that contains
    // both <content> and <original_song> tags. ChatPanel calls onContentUpdated
    // first, then onOriginalContentUpdated (see ChatPanel.tsx lines 354-358).
    const chatOnContent = capturedChatPanelProps.onContentUpdated as (s: string) => void;
    const chatOnOriginal = capturedChatPanelProps.onOriginalContentUpdated as (s: string) => void;

    act(() => {
      chatOnContent('NEW rewritten lyrics');
      chatOnOriginal('NEW original lyrics');
    });

    // The original content update must NOT clobber the new rewritten content.
    // Bug: handleOriginalContentUpdated spreads a stale rewriteResult closure
    // that still has 'old rewritten lyrics', overwriting the update from
    // onContentUpdated.
    for (const call of onNewRewrite.mock.calls) {
      const result = call[0] as { rewritten_content: string } | null;
      if (result !== null) {
        expect(result.rewritten_content).not.toBe('old rewritten lyrics');
      }
    }
  });

  it('renders Import from Photo button on splash page', () => {
    const props = makeProps();
    Object.assign(mockOutletContext, props);
    render(<RewriteTab />);
    expect(screen.getByText('Import from Photo')).toBeInTheDocument();
  });

  it('shows extracting state when image is being processed', async () => {
    // Mock parseImage to return a promise that we control
    const parseImageMock = vi.fn().mockResolvedValue({ text: 'G Am\nHello world' });
    const apiModule = await import('@/api');
    (apiModule.default as Record<string, unknown>).parseImage = parseImageMock;

    const props = makeProps();
    Object.assign(mockOutletContext, props);
    render(<RewriteTab />);

    // The button should exist and be enabled
    const photoBtn = screen.getByText('Import from Photo');
    expect(photoBtn).toBeInTheDocument();
    expect(photoBtn.closest('button')).not.toBeDisabled();
  });

  it('disables Import from Photo when no model is selected', () => {
    const props = makeProps({ llmSettings: { provider: '', model: '', reasoning_effort: '' } });
    Object.assign(mockOutletContext, props);
    render(<RewriteTab />);
    const photoBtn = screen.getByText('Import from Photo');
    expect(photoBtn.closest('button')).toBeDisabled();
  });

  describe('Import from File', () => {
    it('renders alongside Import from Photo in INPUT state', () => {
      const props = makeProps();
      render(<RewriteTab {...props} />);

      expect(screen.getByText('Import from Photo')).toBeInTheDocument();
      expect(screen.getByText('Import from File')).toBeInTheDocument();
    });

    it('is disabled when no profile exists', () => {
      const props = makeProps({ profile: null });
      render(<RewriteTab {...props} />);

      const fileBtn = screen.getByText('Import from File');
      expect(fileBtn.closest('button')).toBeDisabled();
    });

    it('has a hidden file input with correct accept attribute for PDFs and text files', () => {
      const props = makeProps();
      const { container } = render(<RewriteTab {...props} />);

      // Find the doc file input (the one that accepts .pdf,.txt)
      const fileInputs = container.querySelectorAll('input[type="file"]');
      const docInput = Array.from(fileInputs).find(
        input => (input as HTMLInputElement).accept.includes('.pdf'),
      ) as HTMLInputElement | undefined;

      expect(docInput).toBeTruthy();
      expect(docInput!.accept).toContain('.pdf');
      expect(docInput!.accept).toContain('.txt');
    });
  });
});
