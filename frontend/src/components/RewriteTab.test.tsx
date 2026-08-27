import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import RewriteTab from '@/components/RewriteTab';
import type { AppShellContext } from '@/layouts/AppShell';
import type { ChatMessage, ParseResult } from '@/types';

// Mock react-router-dom: provide useOutletContext + a captured useNavigate
const mockOutletContext: Partial<AppShellContext> = {};
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useOutletContext: () => mockOutletContext, useNavigate: () => mockNavigate };
});

// Mock api module
vi.mock('@/api', () => ({
  default: {
    parseStream: vi.fn(),
    parseImage: vi.fn().mockResolvedValue({ text: '' }),
    extractFile: vi.fn().mockResolvedValue({ text: '' }),
    scrapeUrl: vi.fn().mockResolvedValue({ text: '', title: null, artist: null, source_url: '' }),
    listSongs: vi.fn().mockResolvedValue([]),
    updateSong: vi.fn().mockResolvedValue({}),
    saveSong: vi.fn().mockResolvedValue({ id: 99, uuid: 'uuid-99', profile_id: 1 }),
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
    llmSettings: { model: 'gpt-4o', reasoning_effort: 'high' },
    rewriteResult: null,
    rewriteMeta: null,
    currentSongId: null,
    chatMessages: [] as ChatMessage[],
    setChatMessages: vi.fn(),
    onNewRewrite: vi.fn(),
    onSongSaved: vi.fn(),
    onContentUpdated: vi.fn(),
    onOriginalContentUpdated: vi.fn(),
    onChangeModel: vi.fn(),
    reasoningEffort: 'high',
    onChangeReasoningEffort: vi.fn(),
    models: [] as string[],
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
    parseErrorType: undefined,
    setParseError: vi.fn(),
    onParse: vi.fn().mockResolvedValue(null),
    onCancelParse: vi.fn(),
    onClearParse: vi.fn(),
    ...overrides,
  } as unknown as AppShellContext;
}

/**
 * Selects one of the four import source tabs (Paste / Photo / File / Link).
 *
 * Radix activates a tab on `mousedown`, not on `click`, so `fireEvent.click`
 * alone leaves the panel unchanged and every assertion after it silently tests
 * the Paste tab instead.
 */
function selectImportTab(name: 'Paste' | 'Photo' | 'File' | 'Link') {
  fireEvent.mouseDown(screen.getByRole('tab', { name }));
}

const SAMPLE_LINK_NAME = 'When the Saints Go Marching In';

/**
 * Waits for the sample offer to appear.
 *
 * The offer is gated on a server-confirmed empty library, so on a fresh browser
 * it is absent until the `listSongs` check resolves. Querying for it
 * synchronously finds nothing.
 */
function waitForSampleOffer() {
  return waitFor(() => screen.getByText(SAMPLE_LINK_NAME));
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

    // Type some input so the AI buttons are enabled
    const textarea = screen.getByPlaceholderText(/Paste lyrics/);
    fireEvent.change(textarea, { target: { value: 'Some lyrics here' } });

    // "Tidy up with AI" is the action that streams a parse. "Add to library" is
    // deliberately free and never calls onParse.
    fireEvent.click(screen.getByText('Tidy up with AI'));

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

  describe('free import (Add to library)', () => {
    it('saves the chart verbatim without calling onParse', async () => {
      const onParse = vi.fn();
      const props = makeProps({ onParse });
      render(<RewriteTab {...props} />);

      const textarea = screen.getByPlaceholderText(/Paste lyrics/);
      fireEvent.change(textarea, {
        target: { value: '{title: Wildwood Flower}\n{artist: The Carter Family}\n\nC   F   C' },
      });
      fireEvent.click(screen.getByText('Add to library'));

      await waitFor(() => {
        expect(api.saveSong).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Wildwood Flower',
            artist: 'The Carter Family',
            original_content: '{title: Wildwood Flower}\n{artist: The Carter Family}\n\nC   F   C',
            rewritten_content:
              '{title: Wildwood Flower}\n{artist: The Carter Family}\n\nC   F   C',
          }),
        );
      });

      // The whole point: no AI call, so no credits spent.
      expect(onParse).not.toHaveBeenCalled();
      // And no llm_model is recorded, because nothing was generated.
      expect(api.saveSong).not.toHaveBeenCalledWith(
        expect.objectContaining({ llm_model: expect.anything() }),
      );
    });

    it('saves untitled rather than guessing when the chart has no usable title', async () => {
      const props = makeProps();
      render(<RewriteTab {...props} />);

      fireEvent.change(screen.getByPlaceholderText(/Paste lyrics/), {
        target: { value: 'C G Am F\n| D | A |' },
      });
      fireEvent.click(screen.getByText('Add to library'));

      await waitFor(() => {
        expect(api.saveSong).toHaveBeenCalledWith(
          expect.objectContaining({ title: null, artist: null }),
        );
      });
    });

    it('stays enabled with no model configured, while the AI actions do not', () => {
      // The self-hosted case: no LLM gateway. Importing and playing must still
      // work, which is what gating the plain save on hasModel used to prevent.
      const props = makeProps({ isPremium: false, llmSettings: { model: '', reasoning_effort: 'high' } });
      render(<RewriteTab {...props} />);

      fireEvent.change(screen.getByPlaceholderText(/Paste lyrics/), {
        target: { value: 'Some chart' },
      });

      expect(screen.getByText('Add to library').closest('button')).not.toBeDisabled();
      expect(screen.getByText('Tidy up with AI').closest('button')).toBeDisabled();
      expect(screen.getByText(/Importing and playing work without one/)).toBeInTheDocument();
    });

    it('keeps the draft and surfaces an error when the save fails', async () => {
      (api.saveSong as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('cap reached'));
      const props = makeProps();
      render(<RewriteTab {...props} />);

      const textarea = screen.getByPlaceholderText(/Paste lyrics/);
      fireEvent.change(textarea, { target: { value: 'Keep me' } });
      fireEvent.click(screen.getByText('Add to library'));

      await waitFor(() => {
        expect(props.setParseError).toHaveBeenCalledWith(
          expect.stringContaining('cap reached'),
        );
      });
      // The paste must survive a failed save.
      expect(textarea).toHaveValue('Keep me');
    });
  });

  it('shows the import heading in INPUT state', () => {
    const props = makeProps();
    render(<RewriteTab {...props} />);

    expect(screen.getByText('Import a song')).toBeInTheDocument();
    // Both import destinations are offered.
    expect(screen.getByRole('button', { name: 'Add to library' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import & rewrite' })).toBeInTheDocument();
  });

  it('shows the rewrite heading in PARSED state', () => {
    const props = makeProps({
      parseResult: { title: 'Test', artist: 'Test', original_content: 'content' } as ParseResult,
      parsedContent: 'content',
    });
    render(<RewriteTab {...props} />);

    expect(screen.getByText('Rewrite your song')).toBeInTheDocument();
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

  it('calls setParseResult when sample song is clicked', async () => {
    const setParseResult = vi.fn();
    const setParsedContent = vi.fn();
    const props = makeProps({ setParseResult, setParsedContent });
    render(<RewriteTab {...props} />);

    const sampleLink = await waitForSampleOffer();

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

  it('offers a sample above the box when the library is confirmed empty', async () => {
    const props = makeProps();
    render(<RewriteTab {...props} />);

    await waitForSampleOffer();
    const sampleText = screen.getByText(/Start with a sample/);
    const textarea = screen.getByPlaceholderText(/Paste lyrics/);

    // Sample prompt should appear before the textarea in the DOM
    expect(sampleText.compareDocumentPosition(textarea) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('offers no sample to someone who already has charts (localStorage)', async () => {
    // There used to be a second "Or try a sample" row below the box, shown on
    // exactly this condition. Someone with a library is the one audience with no
    // use for a sample, so the offer is now suppressed rather than relocated.
    localStorage.setItem(STORAGE_KEYS.HAS_REWRITTEN, '1');
    const props = makeProps();
    render(<RewriteTab {...props} />);

    // Wait for the import screen so this cannot pass by asserting on nothing.
    await waitFor(() => expect(screen.getByPlaceholderText(/Paste lyrics/)).toBeInTheDocument());

    expect(screen.queryByText(SAMPLE_LINK_NAME)).not.toBeInTheDocument();
    expect(screen.queryByText(/sample/i)).not.toBeInTheDocument();
  });

  it('never flashes the sample offer before the song count is known', async () => {
    // `hasSongs` starts false on any fresh browser, so gating on that alone
    // showed a sample offer to returning users with a full library until the
    // check came back.
    vi.mocked(api.listSongs).mockReturnValueOnce(new Promise(() => {}) as never);
    render(<RewriteTab {...makeProps()} />);

    await waitFor(() => expect(screen.getByPlaceholderText(/Paste lyrics/)).toBeInTheDocument());
    expect(screen.queryByText(SAMPLE_LINK_NAME)).not.toBeInTheDocument();
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

  it('offers no sample when the server reports existing charts (cross-browser)', async () => {
    // No localStorage set, but the server returns songs for this profile: the
    // user has charts on another device, so they are not a new user here either.
    vi.mocked(api.listSongs).mockResolvedValueOnce([{ id: 1 }] as never);
    const props = makeProps();
    render(<RewriteTab {...props} />);

    await waitFor(() => expect(api.listSongs).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByPlaceholderText(/Paste lyrics/)).toBeInTheDocument());

    expect(screen.queryByText(SAMPLE_LINK_NAME)).not.toBeInTheDocument();
  });

  // The always-visible "+ New Song" button now lives in the global chrome
  // (tab bar / mobile nav, see Tabs/MobileNav tests). RewriteTab keeps a
  // contextual mobile "+ New" button in the song toolbar that runs the same
  // discard flow.
  describe('New Song button (mobile toolbar)', () => {
    it('renders in PARSED state', () => {
      const props = makeProps({
        parseResult: { title: 'Test', artist: 'Test', original_content: 'content' } as ParseResult,
        parsedContent: 'content',
      });
      render(<RewriteTab {...props} />);

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

      expect(screen.getByRole('button', { name: '+ New' })).toBeInTheDocument();
    });

    it('does not render in INPUT state', () => {
      const props = makeProps();
      render(<RewriteTab {...props} />);

      expect(screen.queryByRole('button', { name: '+ New' })).not.toBeInTheDocument();
    });

    it('starts a new song immediately (no dialog) in WORKSHOPPING state', () => {
      const onNewRewrite = vi.fn();
      const onClearParse = vi.fn();
      const props = makeProps({
        rewriteResult: {
          original_content: '[C]Hello [G]World',
          rewritten_content: '[C]Hello [G]World',
          changes_summary: 'No changes',
        },
        rewriteMeta: { title: 'Test', artist: 'Test' },
        currentSongId: 1,
        onNewRewrite,
        onClearParse,
      });
      render(<RewriteTab {...props} />);

      fireEvent.click(screen.getByRole('button', { name: '+ New' }));

      // The song is autosaved to the Library, so no discard confirmation is
      // shown; it just clears the workspace.
      expect(screen.queryByText('Discard unsaved lyrics?')).not.toBeInTheDocument();
      expect(onClearParse).toHaveBeenCalled();
      expect(onNewRewrite).toHaveBeenCalledWith(null, null);
    });

    it('calls onClearParse when New is clicked in PARSED state', () => {
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

      fireEvent.click(screen.getByRole('button', { name: '+ New' }));

      // Should not show dialog (parsed state with no chat messages)
      expect(screen.queryByText('Start New Song')).not.toBeInTheDocument();

      // Should have called onClearParse to clear parse state in AppShell
      expect(onClearParse).toHaveBeenCalled();
      expect(onNewRewrite).toHaveBeenCalledWith(null, null);
    });

    it('resets local input when the global newSongNonce changes', () => {
      const props = makeProps({
        parseResult: { title: 'Test', artist: 'Test', original_content: 'content' } as ParseResult,
        parsedContent: 'content',
        newSongNonce: 0,
      });
      const { rerender } = render(<RewriteTab {...props} />);

      // Simulate the global button: AppShell clears shared state and bumps the nonce.
      rerender(
        <RewriteTab
          {...props}
          parseResult={null}
          parsedContent=""
          rewriteResult={null}
          newSongNonce={1}
        />,
      );

      // Back to the INPUT view with an empty textarea (no leftover title/input).
      expect(screen.getByPlaceholderText(/Paste lyrics/)).toHaveValue('');
    });
  });

  describe('Import from Link', () => {
    it('renders the Link tab in INPUT state', () => {
      render(<RewriteTab {...makeProps()} />);
      expect(screen.getByRole('tab', { name: 'Link' })).toBeInTheDocument();
    });

    it('reveals an inline URL field when the tab is selected, with no dialog', () => {
      render(<RewriteTab {...makeProps()} />);
      // The field is behind the tab, not present until it is chosen.
      expect(screen.queryByPlaceholderText('https://...')).not.toBeInTheDocument();

      selectImportTab('Link');

      expect(screen.getByPlaceholderText('https://...')).toBeInTheDocument();
      // This used to be a modal. A dialog on top of a tab strip offering the
      // same thing would be two doors to one room.
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('scrapes the URL and populates the textarea with the returned text', async () => {
      vi.mocked(api.scrapeUrl).mockResolvedValue({
        text: 'Test Song - Test Artist\n\nG  D\nsample lyric line',
        title: 'Test Song',
        artist: 'Test Artist',
        source_url: 'https://chords.example.com/some-song',
      });

      render(<RewriteTab {...makeProps()} />);
      selectImportTab('Link');

      const urlInput = screen.getByPlaceholderText('https://...');
      fireEvent.change(urlInput, {
        target: { value: 'https://chords.example.com/some-song' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Fetch chords' }));

      await waitFor(() => {
        expect(api.scrapeUrl).toHaveBeenCalledWith({
          profile_id: 1,
          url: 'https://chords.example.com/some-song',
        });
      });

      // The Link panel hands off to the Paste tab, where the fetched text is
      // visible and editable before it is saved.
      await waitFor(() => {
        const textarea = screen.getByPlaceholderText(/Paste lyrics/) as HTMLTextAreaElement;
        expect(textarea.value).toContain('sample lyric line');
      });
    });

    it('records source_url on the saved song after importing from a link', async () => {
      const parseResult = {
        title: 'Test Song',
        artist: 'Test Artist',
        original_content: 'G  D\nsample lyric line',
      } as ParseResult;
      const onParse = vi.fn().mockResolvedValue(parseResult);
      vi.mocked(api.scrapeUrl).mockResolvedValue({
        text: 'G  D\nsample lyric line',
        title: 'Test Song',
        artist: 'Test Artist',
        source_url: 'https://chords.example.com/some-song',
      });
      vi.mocked(api.saveSong).mockResolvedValue({ id: 7, uuid: 'uuid-7', profile_id: 1 } as never);

      render(<RewriteTab {...makeProps({ onParse })} />);

      // Add content from a link
      selectImportTab('Link');
      fireEvent.change(screen.getByPlaceholderText('https://...'), {
        target: { value: 'https://chords.example.com/some-song' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Fetch chords' }));

      await waitFor(() => expect(api.scrapeUrl).toHaveBeenCalled());

      // Then run the import
      await waitFor(() => screen.getByText('Add to library'));
      fireEvent.click(screen.getByText('Add to library'));

      await waitFor(() => {
        expect(api.saveSong).toHaveBeenCalledWith(expect.objectContaining({
          source_url: 'https://chords.example.com/some-song',
        }));
      });
    });

    it('surfaces an error when scraping fails', async () => {
      const setParseError = vi.fn();
      vi.mocked(api.scrapeUrl).mockRejectedValue(new Error('That site blocked the request.'));

      render(<RewriteTab {...makeProps({ setParseError })} />);
      selectImportTab('Link');
      fireEvent.change(screen.getByPlaceholderText('https://...'), {
        target: { value: 'https://example.com/song' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Fetch chords' }));

      await waitFor(() => {
        expect(setParseError).toHaveBeenCalledWith(expect.stringContaining('blocked'));
      });
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

  it('offers a photo picker behind the Photo tab', () => {
    const props = makeProps();
    Object.assign(mockOutletContext, props);
    render(<RewriteTab />);
    selectImportTab('Photo');
    expect(screen.getByRole('button', { name: 'Choose photo' })).toBeInTheDocument();
  });

  it('enables the photo picker when a model is configured', async () => {
    // Mock parseImage to return a promise that we control
    const parseImageMock = vi.fn().mockResolvedValue({ text: 'G Am\nplaceholder line' });
    const apiModule = await import('@/api');
    (apiModule.default as Record<string, unknown>).parseImage = parseImageMock;

    const props = makeProps();
    Object.assign(mockOutletContext, props);
    render(<RewriteTab />);
    selectImportTab('Photo');

    expect(screen.getByRole('button', { name: 'Choose photo' })).not.toBeDisabled();
  });

  it('disables the photo picker when no model is selected, and says why', () => {
    const props = makeProps({ llmSettings: { model: '', reasoning_effort: '' } });
    Object.assign(mockOutletContext, props);
    render(<RewriteTab />);
    selectImportTab('Photo');

    expect(screen.getByRole('button', { name: 'Choose photo' })).toBeDisabled();
    // Photo is the only one of the four that needs a model, so the note has to
    // say so rather than reading as though import is broken.
    expect(screen.getByText(/other three ways in work without one/)).toBeInTheDocument();
  });

  describe('import source tabs', () => {
    it('offers all four ways in, with Paste selected first', () => {
      render(<RewriteTab {...makeProps()} />);

      for (const name of ['Paste', 'Photo', 'File', 'Link'] as const) {
        expect(screen.getByRole('tab', { name })).toBeInTheDocument();
      }
      expect(screen.getByRole('tab', { name: 'Paste' })).toHaveAttribute('aria-selected', 'true');
    });

    it('keeps the save actions on the Paste tab, which is where the text lands', () => {
      render(<RewriteTab {...makeProps()} />);
      expect(screen.getByText('Add to library')).toBeInTheDocument();

      selectImportTab('File');

      // Photo/file/link only fill the paste box. Repeating the save actions on
      // each source would imply each one saves directly, which none of them do.
      expect(screen.queryByText('Add to library')).not.toBeInTheDocument();
    });

    it('names its tablist, since the app nav is a second one on the same page', () => {
      render(<RewriteTab {...makeProps()} />);
      // Unlabelled, a screen reader announces two indistinguishable tab lists.
      expect(screen.getByRole('tablist', { name: 'Import source' })).toBeInTheDocument();
    });

    it('focuses the URL field when the Link tab is chosen', () => {
      // The dialog this replaced autofocused its field, so choosing "Link" and
      // typing straight away worked. Losing that is a silent downgrade.
      render(<RewriteTab {...makeProps()} />);
      selectImportTab('Link');

      expect(screen.getByPlaceholderText('https://...')).toHaveFocus();
    });

    it('hands off to the Paste tab once a source produces text', async () => {
      vi.mocked(api.scrapeUrl).mockResolvedValue({
        text: 'G  D\nfetched placeholder line',
        title: 'Test Song',
        artist: 'Test Artist',
        source_url: 'https://chords.example.com/some-song',
      });

      render(<RewriteTab {...makeProps()} />);
      selectImportTab('Link');
      fireEvent.change(screen.getByPlaceholderText('https://...'), {
        target: { value: 'https://chords.example.com/some-song' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Fetch chords' }));

      // Without the handoff the fetch looks like it did nothing: the text lands
      // in a box on a tab the user is not looking at.
      await waitFor(() => {
        expect(screen.getByRole('tab', { name: 'Paste' })).toHaveAttribute('aria-selected', 'true');
      });
      expect((screen.getByPlaceholderText(/Paste lyrics/) as HTMLTextAreaElement).value)
        .toContain('fetched placeholder line');
    });

    it('warns before an extraction overwrites text already in the paste box', () => {
      render(<RewriteTab {...makeProps()} />);

      selectImportTab('Link');
      expect(screen.queryByText(/replaces what's currently in the Paste tab/)).not.toBeInTheDocument();

      selectImportTab('Paste');
      fireEvent.change(screen.getByPlaceholderText(/Paste lyrics/), {
        target: { value: 'a chart worth not losing' },
      });
      selectImportTab('Link');

      expect(screen.getByText(/replaces what's currently in the Paste tab/)).toBeInTheDocument();
    });
  });

  describe('Import from File', () => {
    it('offers a file picker behind the File tab', () => {
      const props = makeProps();
      render(<RewriteTab {...props} />);
      selectImportTab('File');

      expect(screen.getByRole('button', { name: 'Choose file' })).toBeInTheDocument();
    });

    it('is disabled when no profile exists', () => {
      const props = makeProps({ profile: null });
      render(<RewriteTab {...props} />);
      selectImportTab('File');

      expect(screen.getByRole('button', { name: 'Choose file' })).toBeDisabled();
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

  describe('save after import (issue #223)', () => {
    it('saves song to library immediately after parse completes', async () => {
      const parseResult = {
        title: 'Amazing Grace',
        artist: 'John Newton',
        original_content: '[G]Amazing grace',
      } as ParseResult;
      const onParse = vi.fn().mockResolvedValue(parseResult);
      const onSongSaved = vi.fn();
      vi.mocked(api.saveSong).mockResolvedValue({ id: 42, uuid: 'uuid-42', profile_id: 1 } as never);

      const props = makeProps({ onParse, onSongSaved });
      render(<RewriteTab {...props} />);

      // Type input and click "Import & rewrite" (stays in the workshop)
      const textarea = screen.getByPlaceholderText(/Paste lyrics/);
      fireEvent.change(textarea, { target: { value: 'Amazing grace' } });
      fireEvent.click(screen.getByText('Import & rewrite'));

      await waitFor(() => {
        expect(api.saveSong).toHaveBeenCalledWith(expect.objectContaining({
          profile_id: 1,
          title: 'Amazing Grace',
          artist: 'John Newton',
          original_content: '[G]Amazing grace',
          rewritten_content: '[G]Amazing grace',
        }));
      });

      expect(onSongSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 42, uuid: 'uuid-42' }));
      expect(localStorage.getItem(STORAGE_KEYS.HAS_REWRITTEN)).toBe('1');
    });

    it('add to library saves then navigates to the play view, skipping the workshop', async () => {
      const parseResult = {
        title: 'Amazing Grace',
        artist: 'John Newton',
        original_content: '[G]Amazing grace',
      } as ParseResult;
      const onParse = vi.fn().mockResolvedValue(parseResult);
      const onSongSaved = vi.fn();
      const onClearParse = vi.fn();
      vi.mocked(api.saveSong).mockResolvedValue({ id: 77, uuid: 'uuid-77', profile_id: 1 } as never);

      render(<RewriteTab {...makeProps({ onParse, onSongSaved, onClearParse })} />);

      const textarea = screen.getByPlaceholderText(/Paste lyrics/);
      fireEvent.change(textarea, { target: { value: 'Amazing grace' } });
      fireEvent.click(screen.getByText('Add to library'));

      await waitFor(() => expect(api.saveSong).toHaveBeenCalled());
      // Goes straight to the song's play route and resets the import surface.
      // This used to point at /app/library/:id, which mounted a second copy of
      // the performance surface with no chord panel on it.
      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/app/play/uuid-77'));
      expect(onClearParse).toHaveBeenCalled();
      // Not routed into the workshop (no current-song handoff).
      expect(onSongSaved).not.toHaveBeenCalled();
    });

    it('saves sample song to library when sample is clicked', async () => {
      const onSongSaved = vi.fn();
      vi.mocked(api.saveSong).mockResolvedValue({ id: 50, uuid: 'uuid-50', profile_id: 1 } as never);

      const props = makeProps({ onSongSaved });
      render(<RewriteTab {...props} />);

      fireEvent.click(await waitForSampleOffer());

      await waitFor(() => {
        expect(api.saveSong).toHaveBeenCalledWith(expect.objectContaining({
          profile_id: 1,
          title: 'When the Saints Go Marching In',
        }));
      });

      expect(onSongSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 50 }));
    });

    it('handleBeforeSend returns existing song ID without creating a duplicate', async () => {
      const onSongSaved = vi.fn();
      vi.mocked(api.saveSong).mockClear();

      const props = makeProps({
        parseResult: { title: 'Test', artist: 'A', original_content: 'content' } as ParseResult,
        parsedContent: 'content',
        currentSongId: 42,
        onSongSaved,
      });
      render(<RewriteTab {...props} />);

      // Access the onBeforeSend callback passed to ChatPanel
      const onBeforeSend = capturedChatPanelProps.onBeforeSend as (() => Promise<number>) | undefined;
      expect(onBeforeSend).toBeDefined();

      const result = await onBeforeSend!();
      expect(result).toBe(42);

      // saveSong should NOT have been called (song already exists)
      expect(api.saveSong).not.toHaveBeenCalled();
    });

    it('prevents duplicate saves from rapid sample clicks', async () => {
      const onSongSaved = vi.fn();
      let resolveFirst: (v: unknown) => void;
      const slowSave = new Promise(r => { resolveFirst = r; });
      vi.mocked(api.saveSong)
        .mockReturnValueOnce(slowSave as never)
        .mockResolvedValueOnce({ id: 51, uuid: 'uuid-51', profile_id: 1 } as never);

      const props = makeProps({ onSongSaved });
      render(<RewriteTab {...props} />);

      const sample = await waitForSampleOffer();
      fireEvent.click(sample);

      // Click again while the first save is still in-flight
      // (the guard should prevent the second save from starting)
      fireEvent.click(sample);

      // Resolve the first save
      await act(async () => { resolveFirst!({ id: 50, uuid: 'uuid-50', profile_id: 1 }); });

      // Only one saveSong call should have been made
      expect(api.saveSong).toHaveBeenCalledTimes(1);
    });

    it('autosaves title edits in PARSED state after song is created', async () => {
      vi.useFakeTimers();
      vi.mocked(api.updateSong).mockResolvedValue({} as never);

      const props = makeProps({
        parseResult: { title: 'Test', artist: 'A', original_content: 'content' } as ParseResult,
        parsedContent: 'content',
        currentSongId: 42,
        currentSongUuid: 'uuid-42',
      });
      render(<RewriteTab {...props} />);

      // Edit title in parsed state
      const titleInput = screen.getAllByLabelText('Song title')[0]!;
      fireEvent.change(titleInput, { target: { value: 'Edited Title' } });

      // Advance past debounce
      await act(async () => { vi.advanceTimersByTime(1600); });

      expect(api.updateSong).toHaveBeenCalledWith('uuid-42', expect.objectContaining({
        title: 'Edited Title',
        rewritten_content: 'content',
        original_content: 'content',
      }));

      vi.useRealTimers();
    });
  });
});
