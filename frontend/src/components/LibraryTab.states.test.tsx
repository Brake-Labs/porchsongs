import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import api from '@/api';
import LibraryTab from '@/components/LibraryTab';
import type { AppShellContext } from '@/layouts/AppShell';
import type { Song } from '@/types';

const MOCK_SONG = vi.hoisted<Song>(() => ({
  id: 42,
  uuid: 'test-uuid-123',
  user_id: 1,
  profile_id: 1,
  title: 'Amazing Grace',
  artist: 'John Newton',
  source_url: null,
  original_content: 'Amazing grace how sweet the sound',
  rewritten_content: 'Amazing grace how sweet the sound',
  changes_summary: null,
  llm_provider: null,
  llm_model: null,
  status: 'completed',
  current_version: 1,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
}) as unknown as Song);

const capNoticeProps = vi.hoisted(() => ({ current: null as { count: number } | null }));
vi.mock('@/extensions', async () => {
  const actual = await vi.importActual<typeof import('@/extensions')>('@/extensions');
  return {
    ...actual,
    SongCapNotice: (props: { count: number }) => {
      capNoticeProps.current = props;
      return null;
    },
  };
});

vi.mock('@/api', () => ({
  default: {
    listSongs: vi.fn(),
    getSong: vi.fn().mockResolvedValue(MOCK_SONG),
    getSongRevisions: vi.fn().mockResolvedValue([]),
  },
  STORAGE_KEYS: {
    CURRENT_SONG_ID: 'test_song_id',
    LIBRARY_LAYOUT: 'test_library_layout',
    PERFORMANCE_LAYOUT: 'test_perf_layout',
    PERFORMANCE_VERSION: 'test_perf_version',
  },
}));

const stubContext = {
  profile: { id: 1, is_default: true },
  llmSettings: { model: '', reasoning_effort: 'high' },
  onLoadSong: vi.fn(),
} as unknown as AppShellContext;

function renderLibrary() {
  return render(
    <MemoryRouter initialEntries={['/app/library']}>
      <Routes>
        <Route element={<Outlet context={stubContext} />}>
          <Route path="/app/library" element={<LibraryTab />} />
        </Route>
        {/* Sentinels so navigation is observable. */}
        <Route path="/app/play/:uuid" element={<div>PLAY ROUTE</div>} />
        <Route path="/app/rewrite" element={<div>IMPORT ROUTE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const mockListSongs = api.listSongs as ReturnType<typeof vi.fn>;

describe('LibraryTab load states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('shows an error state, not an empty library, when the fetch fails', async () => {
    // Previously the catch swallowed the error and left songs as [], so a 500 or an
    // expired session told a user with 200 charts that their library was empty and
    // invited them to add their first song.
    mockListSongs.mockRejectedValue(new Error('500 Internal Server Error'));
    renderLibrary();

    await waitFor(() =>
      expect(screen.getByText('Could not load your library')).toBeInTheDocument(),
    );
    expect(screen.getByText(/Your charts are safe/)).toBeInTheDocument();
    expect(screen.queryByText('Your library is empty')).not.toBeInTheDocument();
  });

  it('retries the fetch from the error state', async () => {
    mockListSongs.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce([MOCK_SONG]);
    renderLibrary();

    await waitFor(() =>
      expect(screen.getByText('Could not load your library')).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByText('Try again'));

    await waitFor(() => expect(screen.getByText('Amazing Grace')).toBeInTheDocument());
    expect(mockListSongs).toHaveBeenCalledTimes(2);
  });

  it('offers an import affordance when the library is genuinely empty', async () => {
    mockListSongs.mockResolvedValue([]);
    renderLibrary();

    await waitFor(() => expect(screen.getByText('Your library is empty')).toBeInTheDocument());
    // The old copy said "Songs you rewrite will appear here. Head to the Rewrite
    // tab", which described the product this rebrand is moving away from.
    expect(screen.getByText(/Import a chord chart to get started/)).toBeInTheDocument();
    expect(screen.queryByText(/Songs you rewrite will appear here/)).not.toBeInTheDocument();
  });

  it('gives SongCapNotice the library chart count', async () => {
    // The library owns the count, so premium's notice is passed it rather than
    // refetching. Asserting the prop keeps this honest whichever implementation of
    // the seam member is present: the OSS stub renders nothing.
    mockListSongs.mockResolvedValue([MOCK_SONG, { ...MOCK_SONG, id: 43, uuid: 'u-43' }]);
    renderLibrary();

    await waitFor(() => expect(capNoticeProps.current).not.toBeNull());
    expect(capNoticeProps.current?.count).toBe(2);
  });

  it('opens the play route when a card is tapped', async () => {
    mockListSongs.mockResolvedValue([MOCK_SONG]);
    renderLibrary();

    await waitFor(() => expect(screen.getByText('Amazing Grace')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Amazing Grace'));

    await waitFor(() => expect(screen.getByText('PLAY ROUTE')).toBeInTheDocument());
  });

  it('does not turn the card title into a text input', async () => {
    // The title was an inline editor that stopped propagation, so tapping the
    // largest target on the card opened a rename field instead of the song.
    mockListSongs.mockResolvedValue([MOCK_SONG]);
    renderLibrary();

    await waitFor(() => expect(screen.getByText('Amazing Grace')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Amazing Grace'));

    expect(screen.queryByPlaceholderText('Untitled')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('PLAY ROUTE')).toBeInTheDocument());
  });
});
