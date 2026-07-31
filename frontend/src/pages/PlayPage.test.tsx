import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import api from '@/api';
import PlayPage from '@/pages/PlayPage';
import { stepFontSize, nearestFontStep, FONT_STEPS } from '@/components/PlayView';
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
    folder: null,
    status: 'draft',
    ...overrides,
  } as unknown as Song;
}

function renderAt(uuid: string, ctx: Record<string, unknown> = {}) {
  return render(
    <MemoryRouter initialEntries={[`/app/play/${uuid}`]}>
      <Routes>
        <Route element={<Outlet context={{ llmSettings: { model: '' }, ...ctx }} />}>
          <Route path="/app/play/:uuid" element={<PlayPage />} />
        </Route>
        <Route path="/app/library" element={<div>library list</div>} />
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
    mockGetSong.mockResolvedValue(
      makeSong({ original_content: 'same', rewritten_content: 'same' }),
    );
    const { unmount } = renderAt('abc-123');
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeInTheDocument());
    expect(screen.queryByLabelText('Song version')).not.toBeInTheDocument();
    unmount();

    mockGetSong.mockResolvedValue(makeSong());
    renderAt('abc-123');
    await waitFor(() => expect(screen.getByLabelText('Song version')).toBeInTheDocument());
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
    (api.updateSong as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('read only'));
    mockGetSong.mockResolvedValue(makeSong({ font_size: 22 }));
    renderAt('abc-123');

    await waitFor(() => expect(screen.getByText('22px')).toBeInTheDocument());
    // A read-only account cannot PUT, and a viewing preference must not surface an
    // error on the one screen where text size matters.
    expect(screen.queryByText(/Could not/)).not.toBeInTheDocument();
  });
});

describe('font size stepping', () => {
  it('exposes sizes that reach a tablet on a music stand', () => {
    // The old range input topped out at 28 with a solver ceiling of 18.
    expect(FONT_STEPS[FONT_STEPS.length - 1]).toBe(32);
  });

  it('snaps an arbitrary stored size to the nearest step', () => {
    expect(nearestFontStep(15)).toBe(14);
    expect(nearestFontStep(21)).toBe(22);
    expect(nearestFontStep(99)).toBe(32);
    expect(nearestFontStep(1)).toBe(12);
  });

  it('steps up and down without leaving the range', () => {
    expect(stepFontSize(16, 1)).toBe(18);
    expect(stepFontSize(16, -1)).toBe(14);
    expect(stepFontSize(32, 1)).toBe(32);
    expect(stepFontSize(12, -1)).toBe(12);
  });

  it('steps off auto starting from the size the layout picked', () => {
    expect(stepFontSize(null, 1, 16)).toBe(18);
    expect(stepFontSize(null, -1, 16)).toBe(14);
    expect(stepFontSize(null, 1, 26)).toBe(32);
  });
});
