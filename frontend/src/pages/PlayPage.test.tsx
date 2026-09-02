import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Outlet, useLocation } from 'react-router-dom';
import api from '@/api';
import PlayPage from '@/pages/PlayPage';
import { stepFontSize, clampFontSize, FONT_SIZE_MIN, FONT_SIZE_MAX } from '@/components/PlayView';
import type { Song } from '@/types';

vi.mock('@/api', () => ({
  default: {
    getSong: vi.fn(),
    updateSong: vi.fn().mockResolvedValue({}),
    downloadSongPdf: vi.fn().mockResolvedValue(undefined),
  },
  STORAGE_KEYS: {
    CURRENT_SONG_ID: 'test_current_song_id',
    PERFORMANCE_LAYOUT: 'test_perf_layout',
    PERFORMANCE_VERSION: 'test_perf_version',
    WAKE_LOCK: 'test_wake_lock',
  },
}));

// The Follow stack opens a mic and the tuner opens an AudioContext; neither is
// meaningful here and both are covered by their own tests.
vi.mock('@/components/PlayView', async () => {
  const actual = await vi.importActual<typeof import('@/components/PlayView')>(
    '@/components/PlayView',
  );
  return {
    ...actual,
    PerformanceSheet: ({ song, version }: { song: Song; version: string }) => (
      <div data-testid="sheet" data-version={version}>
        {version === 'original' ? song.original_content : song.rewritten_content}
      </div>
    ),
  };
});

vi.mock('@/components/TunerDialog', () => ({ default: () => null }));

function makeSong(overrides: Partial<Song> = {}): Song {
  return {
    id: 1,
    uuid: 'abc-123',
    profile_id: 1,
    title: 'Wildwood Flower',
    artist: 'The Carter Family',
    original_content: 'C   F   C\nOriginal words',
    rewritten_content: 'C   F   C\nMy words',
    font_size: null,
    tags: [],
    status: 'draft',
    ...overrides,
  } as unknown as Song;
}

/** Reports the library URL the back button landed on, query string included. */
function LibraryProbe() {
  const location = useLocation();
  return <div data-testid="library-url">{location.pathname + location.search}</div>;
}

function renderAt(uuid: string, ctx: Record<string, unknown> = {}, state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: `/app/play/${uuid}`, state }]}>
      <Routes>
        <Route element={<Outlet context={{ llmSettings: { model: '' }, ...ctx }} />}>
          <Route path="/app/play/:uuid" element={<PlayPage />} />
        </Route>
        <Route path="/app/library" element={<LibraryProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

const mockGetSong = api.getSong as ReturnType<typeof vi.fn>;

describe('PlayPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('resolves a song by uuid on a cold deep link', async () => {
    // The library's old deep-link path only matched songs already in its
    // in-memory list, so a bookmark or a PWA relaunch rendered nothing.
    mockGetSong.mockResolvedValue(makeSong());
    renderAt('abc-123');

    await waitFor(() => expect(screen.getByTestId('sheet')).toBeInTheDocument());
    expect(mockGetSong).toHaveBeenCalledWith('abc-123');
    expect(screen.getByText('Wildwood Flower')).toBeInTheDocument();
    expect(screen.getByText('The Carter Family')).toBeInTheDocument();
  });

  it('goes back to the library view the chart was opened from', async () => {
    // The library keeps its filters in the query string, and hands the whole
    // address over as `from`. Without it, playing a chart out of an artist or a
    // tag and pressing back drops you into an unfiltered list.
    mockGetSong.mockResolvedValue(makeSong());
    const user = userEvent.setup();
    renderAt('abc-123', {}, { from: '/app/library?view=artists&artist=neil+young' });

    await waitFor(() => expect(screen.getByTestId('sheet')).toBeInTheDocument());
    await user.click(screen.getByLabelText('Back to library'));

    expect(screen.getByTestId('library-url').textContent).toBe(
      '/app/library?view=artists&artist=neil+young',
    );
  });

  it('ignores a back destination that is not the library', async () => {
    // Navigation state is not something this route controls, so an arbitrary
    // string in it must not become a redirect.
    mockGetSong.mockResolvedValue(makeSong());
    const user = userEvent.setup();
    renderAt('abc-123', {}, { from: 'https://example.com/phish' });

    await waitFor(() => expect(screen.getByTestId('sheet')).toBeInTheDocument());
    await user.click(screen.getByLabelText('Back to library'));

    expect(screen.getByTestId('library-url').textContent).toBe('/app/library');
  });

  it('falls back to the library when a deep link arrives with no back destination', async () => {
    mockGetSong.mockResolvedValue(makeSong());
    const user = userEvent.setup();
    renderAt('abc-123');

    await waitFor(() => expect(screen.getByTestId('sheet')).toBeInTheDocument());
    await user.click(screen.getByLabelText('Back to library'));

    expect(screen.getByTestId('library-url').textContent).toBe('/app/library');
  });

  it('shows a loading state that still offers a way back', () => {
    mockGetSong.mockReturnValue(new Promise(() => {}));
    renderAt('abc-123');

    expect(screen.getByText(/Loading chart/)).toBeInTheDocument();
    // A full-screen route with no header must never be a dead end.
    expect(screen.getByLabelText('Back to library')).toBeInTheDocument();
  });

  it('shows a not-found state with a route home when the song is gone', async () => {
    mockGetSong.mockRejectedValue(new Error('Song not found'));
    renderAt('missing');

    await waitFor(() => expect(screen.getByText(/This chart is not here/)).toBeInTheDocument());
    expect(screen.getByText('Back to library')).toBeInTheDocument();
  });

  it('distinguishes a network error from a missing song, and offers retry', async () => {
    mockGetSong.mockRejectedValue(new Error('Failed to fetch'));
    renderAt('abc-123');

    await waitFor(() => expect(screen.getByText(/Could not load this chart/)).toBeInTheDocument());
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('handles a chart with no content instead of rendering a blank screen', async () => {
    // usePerformanceLayout bails when the longest line is 0, leaving fontSize
    // undefined forever, so without this branch the user sees nothing at all.
    mockGetSong.mockResolvedValue(makeSong({ original_content: '', rewritten_content: '   ' }));
    renderAt('abc-123');

    await waitFor(() => expect(screen.getByText(/This chart is empty/)).toBeInTheDocument());
  });

  it('offers the version toggle only when the original differs', async () => {
    const user = userEvent.setup();
    mockGetSong.mockResolvedValue(
      makeSong({ original_content: 'same', rewritten_content: 'same' }),
    );
    const { unmount } = renderAt('abc-123');
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Chart settings' }));
    await waitFor(() => expect(screen.getByLabelText('Capo fret')).toBeInTheDocument());
    expect(screen.queryByLabelText('Song version')).not.toBeInTheDocument();
    unmount();

    mockGetSong.mockResolvedValue(makeSong());
    renderAt('abc-123');
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Chart settings' }));
    await waitFor(() => expect(screen.getByLabelText('Song version')).toBeInTheDocument());
  });

  // The next two moved here from LibraryTab.version.test.tsx, which exercised
  // the toggle on the second performance surface that used to live inside the
  // library. There is one surface now, so this is where the behaviour lives.
  it('switches the sheet to the original and back', async () => {
    const user = userEvent.setup();
    mockGetSong.mockResolvedValue(makeSong());
    renderAt('abc-123');

    await waitFor(() => expect(screen.getByTestId('sheet')).toHaveTextContent('My words'));

    await user.click(screen.getByRole('button', { name: 'Chart settings' }));
    await waitFor(() => expect(screen.getByLabelText('Song version')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Original' }));
    expect(screen.getByTestId('sheet')).toHaveTextContent('Original words');
    expect(screen.getByTestId('sheet')).not.toHaveTextContent('My words');

    await user.click(screen.getByRole('button', { name: 'Your Version' }));
    expect(screen.getByTestId('sheet')).toHaveTextContent('My words');
  });

  it('remembers the last chosen version across songs', async () => {
    // A preference, not a per-song setting: someone performing from originals
    // is performing from originals all evening.
    localStorage.setItem('test_perf_version', 'original');
    mockGetSong.mockResolvedValue(makeSong());
    renderAt('abc-123');

    await waitFor(() => expect(screen.getByTestId('sheet')).toHaveTextContent('Original words'));
  });

  it('ignores a stored original preference when there is nothing distinct to show', async () => {
    localStorage.setItem('test_perf_version', 'original');
    mockGetSong.mockResolvedValue(
      makeSong({ original_content: 'same', rewritten_content: 'same' }),
    );
    renderAt('abc-123');

    await waitFor(() => expect(screen.getByTestId('sheet')).toBeInTheDocument());
    expect(screen.getByTestId('sheet')).toHaveAttribute('data-version', 'rewritten');
  });

  it('exposes the tuner and a tap-to-engage wake lock on the chart', async () => {
    mockGetSong.mockResolvedValue(makeSong());
    renderAt('abc-123');

    await waitFor(() => expect(screen.getByTestId('sheet')).toBeInTheDocument());
    // Both were previously reachable only from the global header, which this
    // route does not render.
    expect(screen.getByLabelText('Open tuner')).toBeInTheDocument();
    // Engaged on tap, never automatically: the nosleep fallback needs a gesture.
    expect(screen.getByText('Stay awake')).toBeInTheDocument();
  });

  it('records the song as the last surface so a PWA relaunch returns here', async () => {
    mockGetSong.mockResolvedValue(makeSong());
    renderAt('abc-123');
    await waitFor(() => expect(localStorage.getItem('test_current_song_id')).toBe('abc-123'));
  });

  it('seeds the font size from the song and never fails visibly when the save is refused', async () => {
    const user = userEvent.setup();
    (api.updateSong as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('read only'));
    mockGetSong.mockResolvedValue(makeSong({ font_size: 22 }));
    renderAt('abc-123');

    await waitFor(() => expect(screen.getByTestId('sheet')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Chart settings' }));
    await waitFor(() => expect(screen.getByText('22px')).toBeInTheDocument());
    // A read-only account cannot PUT, and a viewing preference must not surface an
    // error on the one screen where text size matters.
    expect(screen.queryByText(/Could not/)).not.toBeInTheDocument();
  });
});

describe('font size stepping', () => {
  it('reaches a tablet on a music stand at one end and a dense chart at the other', () => {
    // The ladder this replaced stopped at 32 whether or not the chart was
    // across the room, and its rungs were the only sizes reachable at all.
    expect(FONT_SIZE_MAX).toBe(64);
    expect(FONT_SIZE_MIN).toBe(10);
  });

  it('lands on any whole pixel, not on a rung', () => {
    expect(stepFontSize(16, 1)).toBe(17);
    expect(stepFontSize(16, -1)).toBe(15);
    expect(stepFontSize(23, 1)).toBe(24);
  });

  it('stops at the ends of the range', () => {
    expect(stepFontSize(FONT_SIZE_MAX, 1)).toBe(FONT_SIZE_MAX);
    expect(stepFontSize(FONT_SIZE_MIN, -1)).toBe(FONT_SIZE_MIN);
  });

  it('steps off auto starting from the size the layout picked', () => {
    // A nudge from where the text already is, not a jump to somewhere else.
    expect(stepFontSize(null, 1, 16)).toBe(17);
    expect(stepFontSize(null, -1, 16)).toBe(15);
    expect(stepFontSize(null, 1, 26)).toBe(27);
  });

  it('brings a stored size from the old ladder, or a wild one, into range', () => {
    expect(clampFontSize(22)).toBe(22);
    expect(clampFontSize(15.4)).toBe(15);
    expect(clampFontSize(999)).toBe(FONT_SIZE_MAX);
    expect(clampFontSize(1)).toBe(FONT_SIZE_MIN);
  });
});
