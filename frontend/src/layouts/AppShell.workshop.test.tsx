import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom';
import type { Song } from '@/types';

/**
 * Integration tests for workshop state that has to outlive RewriteTab and
 * ChatPanel: AppShell and the real workshop components, with only the network
 * and the chrome stubbed.
 */

function makeSong(id: number, title: string, content: string): Song {
  return {
    id,
    uuid: `uuid-${id}`,
    user_id: 1,
    profile_id: 1,
    title,
    artist: 'Someone',
    source_url: null,
    original_content: content,
    rewritten_content: content,
    changes_summary: null,
    llm_provider: null,
    llm_model: null,
    status: 'completed',
    current_version: 1,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  } as Song;
}

const SONG_A = vi.hoisted(() => ({ value: null as unknown as Song }));
const SONG_B = vi.hoisted(() => ({ value: null as unknown as Song }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    authState: 'ready',
    currentAuthUser: null,
    authConfig: { required: false },
    isPremium: false,
    handleLogout: vi.fn(),
  }),
}));

vi.mock('@/api', () => ({
  default: {
    listProfiles: vi.fn(),
    listModels: vi.fn(),
    listSongs: vi.fn(),
    getSong: vi.fn(),
    getChatHistory: vi.fn(),
    updateSong: vi.fn(),
    chatStream: vi.fn(),
  },
  ConnectionLostError: class ConnectionLostError extends Error {},
  isProviderError: () => false,
  STORAGE_KEYS: {
    MODEL: 'test_model',
    REASONING_EFFORT: 'test_effort',
    CURRENT_SONG_ID: 'test_song_id',
    DRAFT_INPUT: 'test_draft_input',
    DRAFT_INSTRUCTION: 'test_draft_instruction',
    LAST_SURFACE: 'test_last_surface',
    HAS_REWRITTEN: 'test_has_rewritten',
    WORKSHOP_TOUCHED: 'test_workshop_touched',
    SPLIT_PERCENT: 'test_split_pct',
  },
}));

vi.mock('@/components/Header', () => ({ default: () => <div data-testid="header" /> }));
vi.mock('@/components/MobileNav', () => ({ default: () => null }));
vi.mock('@/components/Tabs', () => ({
  default: () => (
    <nav>
      <Link to="/app/library">to-library</Link>
      <Link to="/app/rewrite">to-workshop</Link>
    </nav>
  ),
}));
// The comparison pane renders chords and editors that are irrelevant here;
// expose just the text that would be on screen.
vi.mock('@/components/ComparisonView', () => ({
  default: ({ rewritten }: { rewritten?: string }) => <pre data-testid="rewritten">{rewritten}</pre>,
}));

import api from '@/api';
import AppShell from '@/layouts/AppShell';
import { useWorkshopActions } from '@/contexts/AppShellContext';
import RewriteTab from '@/components/RewriteTab';

const mockApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

const libraryRenders = { count: 0 };

/** Library stand-in: one button per song, wired to the real onLoadSong. */
function LibraryStub() {
  const ctx = useWorkshopActions();
  libraryRenders.count++;
  return (
    <div data-testid="library">
      <button onClick={() => ctx.onLoadSong(SONG_A.value)}>open-a</button>
      <button onClick={() => ctx.onLoadSong(SONG_B.value)}>open-b</button>
    </div>
  );
}

function renderApp(route = '/app/rewrite') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/app" element={<AppShell />}>
          <Route path="rewrite" element={<RewriteTab />} />
          <Route path="library" element={<LibraryStub />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

beforeAll(() => {
  Element.prototype.scrollTo = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  SONG_A.value = makeSong(1, 'Song A', 'Lyrics of song A');
  SONG_B.value = makeSong(2, 'Song B', 'Lyrics of song B');
  localStorage.setItem('test_song_id', SONG_A.value.uuid);
  localStorage.setItem('test_model', 'gpt-4o');
  localStorage.setItem('test_has_rewritten', '1');
  mockApi.listProfiles!.mockResolvedValue([{ id: 1, is_default: true }]);
  mockApi.listModels!.mockResolvedValue(['gpt-4o']);
  mockApi.listSongs!.mockResolvedValue([]);
  mockApi.getSong!.mockImplementation(async (uuid: string) =>
    uuid === SONG_B.value.uuid ? SONG_B.value : SONG_A.value);
  mockApi.getChatHistory!.mockResolvedValue([]);
  mockApi.updateSong!.mockResolvedValue({});
});

async function waitForWorkshop(title: string) {
  await waitFor(() => expect(screen.getAllByLabelText('Song title')[0]).toHaveValue(title));
}

describe('workshop edits survive leaving the workshop', () => {
  it('saves a pending edit right away when the workshop unmounts before the autosave fires', async () => {
    renderApp();
    await waitForWorkshop('Song A');

    fireEvent.change(screen.getAllByLabelText('Song title')[0]!, { target: { value: 'Song A, retitled' } });
    // Well inside the 1.5s autosave debounce.
    fireEvent.click(screen.getByText('to-library'));
    await screen.findByTestId('library');

    await waitFor(
      () => expect(mockApi.updateSong).toHaveBeenCalledWith(
        SONG_A.value.uuid,
        expect.objectContaining({ title: 'Song A, retitled' }),
      ),
      { timeout: 500 },
    );
  });

  it('shows the edited title, not the loaded one, on returning to the workshop', async () => {
    renderApp();
    await waitForWorkshop('Song A');

    fireEvent.change(screen.getAllByLabelText('Song title')[0]!, { target: { value: 'Song A, retitled' } });
    fireEvent.click(screen.getByText('to-library'));
    await screen.findByTestId('library');
    fireEvent.click(screen.getByText('to-workshop'));

    await waitForWorkshop('Song A, retitled');
  });
});

describe('a chat stream that outlives its song', () => {
  async function startStreamOnA() {
    const stream = deferred<{
      rewritten_content: string | null;
      original_content: string | null;
      changes_summary: string;
      assistant_message: string;
    }>();
    mockApi.chatStream!.mockReturnValue(stream.promise);

    renderApp();
    await waitForWorkshop('Song A');

    const input = screen.getByPlaceholderText(/change the song|change it/);
    fireEvent.change(input, { target: { value: 'Make it about dogs' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    });
    expect(mockApi.chatStream).toHaveBeenCalledTimes(1);
    return stream;
  }

  it('does not write its result into a different song loaded meanwhile', async () => {
    const stream = await startStreamOnA();

    fireEvent.click(screen.getByText('to-library'));
    fireEvent.click(await screen.findByText('open-b'));
    await waitForWorkshop('Song B');

    await act(async () => {
      stream.resolve({
        rewritten_content: 'Dogs everywhere (meant for A)',
        original_content: null,
        changes_summary: 'Made it about dogs',
        assistant_message: 'Made it about dogs',
      });
    });

    expect(screen.queryByText('Dogs everywhere (meant for A)')).not.toBeInTheDocument();
    expect(screen.queryByText('Made it about dogs')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('rewritten')[0]).toHaveTextContent('Lyrics of song B');
    // Song B was never edited, so nothing should be autosaved into it.
    expect(mockApi.updateSong).not.toHaveBeenCalledWith(SONG_B.value.uuid, expect.anything());
  });

  it('still shows the live stream on returning to the same song', async () => {
    const stream = await startStreamOnA();

    fireEvent.click(screen.getByText('to-library'));
    await screen.findByTestId('library');
    fireEvent.click(screen.getByText('to-workshop'));
    await waitForWorkshop('Song A');

    // The send is still in flight, so the panel offers Cancel and queues
    // rather than starting an overlapping request.
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    const input = screen.getByPlaceholderText(/change the song|change it/);
    fireEvent.change(input, { target: { value: 'And cats' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    });
    expect(mockApi.chatStream).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Queued')).toBeInTheDocument();

    mockApi.chatStream!.mockReturnValue(new Promise(() => {}));
    await act(async () => {
      stream.resolve({
        rewritten_content: 'Dogs everywhere',
        original_content: null,
        changes_summary: 'Made it about dogs',
        assistant_message: 'Made it about dogs',
      });
    });

    expect(screen.getAllByTestId('rewritten')[0]).toHaveTextContent('Dogs everywhere');
    expect(screen.getByText('Made it about dogs')).toBeInTheDocument();
    // The queued message goes out once the first finishes.
    expect(mockApi.chatStream).toHaveBeenCalledTimes(2);
  });

  it('does not save a half-streamed chart when leaving mid-reply', async () => {
    let onToken!: (t: string) => void;
    let fail!: (e: Error) => void;
    mockApi.chatStream!.mockImplementation((_req: unknown, tok: (t: string) => void) => {
      onToken = tok;
      return new Promise((_res, rej) => { fail = rej; });
    });
    renderApp();
    await waitForWorkshop('Song A');

    const input = screen.getByPlaceholderText(/change the song|change it/);
    fireEvent.change(input, { target: { value: 'Make it about dogs' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    });
    await act(async () => { onToken('Sure.<content>Dogs every'); });
    expect(screen.getAllByTestId('rewritten')[0]).toHaveTextContent('Dogs every');

    fireEvent.click(screen.getByText('to-library'));
    await screen.findByTestId('library');
    await act(async () => { fail(new Error('provider exploded')); });

    expect(mockApi.updateSong).not.toHaveBeenCalled();
  });

  it('keeps the partial reply on cancel', async () => {
    let onToken!: (t: string) => void;
    mockApi.chatStream!.mockImplementation((_req: unknown, tok: (t: string) => void, signal: AbortSignal) => {
      onToken = tok;
      return new Promise((_res, rej) => {
        signal.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          rej(e);
        });
      });
    });
    renderApp();
    await waitForWorkshop('Song A');

    const input = screen.getByPlaceholderText(/change the song|change it/);
    fireEvent.change(input, { target: { value: 'Make it about dogs' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    });
    await act(async () => { onToken('Here is a partial answer'); });
    await act(async () => { fireEvent.click(screen.getByText('Cancel')); });

    expect(screen.getByText('Here is a partial answer')).toBeInTheDocument();
    expect(screen.getByText('Cancelled.')).toBeInTheDocument();
  });
});

describe('context split', () => {
  it('does not re-render a route that only opens songs when the workshop changes underneath it', async () => {
    let finish!: (v: unknown) => void;
    mockApi.chatStream!.mockReturnValue(new Promise(r => { finish = r; }));
    renderApp();
    await waitForWorkshop('Song A');

    const input = screen.getByPlaceholderText(/change the song|change it/);
    fireEvent.change(input, { target: { value: 'Make it about dogs' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    });
    fireEvent.click(screen.getByText('to-library'));
    await screen.findByTestId('library');
    const before = libraryRenders.count;

    // The reply lands while the library is showing: workshop state changes.
    await act(async () => {
      finish({
        rewritten_content: 'Dogs everywhere',
        original_content: null,
        changes_summary: 'Made it about dogs',
        assistant_message: 'Made it about dogs',
      });
    });

    expect(libraryRenders.count).toBe(before);
  });
});

describe('launch restore', () => {
  it('does not replace a song the user opened while the restore was loading', async () => {
    let resolveA!: (s: Song) => void;
    mockApi.getSong!.mockImplementation((uuid: string) =>
      uuid === SONG_A.value.uuid ? new Promise<Song>(r => { resolveA = r; }) : Promise.resolve(SONG_B.value));
    renderApp('/app/library');

    fireEvent.click(await screen.findByText('open-b'));
    await waitForWorkshop('Song B');
    await act(async () => { resolveA(SONG_A.value); });

    expect(screen.getAllByLabelText('Song title')[0]).toHaveValue('Song B');
    expect(screen.getAllByTestId('rewritten')[0]).toHaveTextContent('Lyrics of song B');
  });
});
