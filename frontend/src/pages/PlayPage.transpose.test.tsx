import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import api from '@/api';
import PlayPage from '@/pages/PlayPage';
import type { Song } from '@/types';

/**
 * The key controls on the play route: transpose, capo, and the one fact they
 * share with the chord panel.
 *
 * The real PerformanceSheet renders here, on purpose. The thing under test is
 * that the chart on screen is the transposed chart, and a stub sheet applying
 * the transform itself would prove only that the stub works.
 */

vi.mock('@/api', () => ({
  default: {
    getSong: vi.fn(),
    updateSong: vi.fn().mockResolvedValue({}),
    downloadSongPdf: vi.fn().mockResolvedValue(undefined),
    fetchSongFile: vi.fn(),
    downloadSongFile: vi.fn().mockResolvedValue(undefined),
    keptSongFiles: vi.fn().mockResolvedValue(new Set()),
    keepSongFileOffline: vi.fn().mockResolvedValue(undefined),
    forgetSongFileOffline: vi.fn().mockResolvedValue(undefined),
  },
  STORAGE_KEYS: {
    CURRENT_SONG_ID: 'test_current_song_id',
    LAST_SURFACE: 'test_last_surface',
    PERFORMANCE_LAYOUT: 'test_perf_layout',
    PERFORMANCE_VERSION: 'test_perf_version',
    WAKE_LOCK: 'test_wake_lock',
    CHORD_INSTRUMENT: 'test_chord_instrument',
    CHORD_TUNING: 'test_chord_tuning',
    CHORD_PANEL_WIDTH: 'test_chord_panel_width',
    SONG_KEYS: 'test_song_keys',
  },
}));

vi.mock('@/components/TunerDialog', () => ({ default: () => null }));

const CHART = ['[Verse 1]', 'G       C       D7', 'Amazing grace how sweet'].join('\n');

function makeSong(overrides: Partial<Song> = {}): Song {
  return {
    id: 1,
    uuid: 'abc-123',
    profile_id: 1,
    kind: 'chart',
    title: 'Amazing Grace',
    artist: 'John Newton',
    original_content: CHART,
    rewritten_content: CHART,
    font_size: null,
    tags: [],
    status: 'ready',
    current_version: 1,
    ...overrides,
  } as unknown as Song;
}

function renderPlay() {
  return render(
    <MemoryRouter initialEntries={['/app/play/abc-123']}>
      <Routes>
        <Route element={<Outlet context={{ llmSettings: { model: '' } }} />}>
          <Route path="/app/play/:uuid" element={<PlayPage />} />
        </Route>
        <Route path="/app/library" element={<div>library</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const mockGetSong = api.getSong as ReturnType<typeof vi.fn>;

/** The chart on screen: the sheet's <pre>, whole. */
function sheetText(): string {
  const pre = document.querySelector('pre');
  expect(pre).not.toBeNull();
  return pre!.textContent ?? '';
}

async function chartLoaded() {
  await waitFor(() => expect(document.querySelector('pre')).not.toBeNull());
}

/** The key controls live in the chart settings sheet now; open it first. */
async function openSettings(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Chart settings' }));
  await waitFor(() => expect(screen.getByLabelText('Capo fret')).toBeInTheDocument());
}

async function closeSettings(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByLabelText('Capo fret')).not.toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockGetSong.mockResolvedValue(makeSong());
});

describe('transpose', () => {
  it('rewrites the chart on screen, and only the chords in it', async () => {
    const user = userEvent.setup();
    renderPlay();
    await chartLoaded();
    expect(sheetText()).toContain('G       C       D7');

    await openSettings(user);
    await user.click(screen.getByRole('button', { name: 'Up a semitone' }));
    await user.click(screen.getByRole('button', { name: 'Up a semitone' }));

    expect(sheetText()).toContain('A       D       E7');
    // The lyric and the section marker do not move.
    expect(sheetText()).toContain('Amazing grace how sweet');
    expect(sheetText()).toContain('[Verse 1]');
  });

  it('resets to the written key from the middle button', async () => {
    const user = userEvent.setup();
    renderPlay();
    await chartLoaded();

    await openSettings(user);
    await user.click(screen.getByRole('button', { name: 'Up a semitone' }));
    expect(sheetText()).toContain('Ab      C#      Eb7');

    await user.click(screen.getByRole('button', { name: /Reset to the written key/ }));
    expect(sheetText()).toContain('G       C       D7');
  });

  it('reopens the song in the key it was left in', async () => {
    const user = userEvent.setup();
    const first = renderPlay();
    await chartLoaded();
    await openSettings(user);
    await user.click(screen.getByRole('button', { name: 'Up a semitone' }));
    await user.click(screen.getByRole('button', { name: 'Up a semitone' }));
    expect(sheetText()).toContain('A       D       E7');
    first.unmount();

    renderPlay();
    await chartLoaded();
    expect(sheetText()).toContain('A       D       E7');
  });
});

describe('capo', () => {
  it('keeps the key and rewrites the chart to the shapes behind the capo', async () => {
    const user = userEvent.setup();
    renderPlay();
    await chartLoaded();

    await openSettings(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Capo fret' }), '2');

    // Sounding key unchanged (transpose still 0); written chords drop by two.
    expect(sheetText()).toContain('F       Bb      C7');
    expect(screen.getByRole('button', { name: 'Transpose: as written' })).toBeInTheDocument();
  });

  it('shows the panel the fingered names, and no capo of its own', async () => {
    const user = userEvent.setup();
    renderPlay();
    await chartLoaded();

    await openSettings(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Capo fret' }), '2');
    await closeSettings(user);
    await user.click(screen.getByRole('button', { name: 'Chords' }));

    // The pills match the chart on screen: F, not the sounding G. It shows up
    // pressed twice, as the song pill and as the root the picker landed on.
    const panel = screen.getByRole('complementary');
    expect(within(panel).getAllByRole('button', { name: 'F', pressed: true })).not.toHaveLength(0);
    // The panel's own capo stays off. Its capo means "shapes that *sound* as
    // this chord over a capo"; the chart already shifted the names down, so
    // handing it the sheet's capo would shift them twice. Tapping F must show
    // the plain F shape you finger behind the capo.
    expect(within(panel).getByRole('button', { name: 'None', pressed: true })).toBeInTheDocument();
  });

  it('offers plain frets, with no capo coaching attached', async () => {
    // The "Try capo N" suggestion and its "open shapes" annotation are gone by
    // design (the Ultimate Guitar treatment): a capo is a plain picker.
    const user = userEvent.setup();
    renderPlay();
    await chartLoaded();

    await openSettings(user);
    const capo = screen.getByRole('combobox', { name: 'Capo fret' });
    const labels = within(capo)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(labels).toEqual(['None', '1', '2', '3', '4', '5', '6', '7']);
    expect(screen.queryByRole('button', { name: /Try capo/ })).not.toBeInTheDocument();
  });
});

describe('follow bar wiring', () => {
  // PlayView.follow.test.tsx proves the PerformanceSheet half of the contract
  // with a stand-in bar; this proves PlayPage actually passes followHandleRef
  // and onFollowStatus, so the real bar button exists and its click reaches the
  // sheet's toggle through the imperative handle.
  it('renders the Follow toggle and routes its click into the sheet', async () => {
    const user = userEvent.setup();
    renderPlay();
    await chartLoaded();

    const follow = await screen.findByRole('button', { name: 'Follow mode: Follow' });
    expect(follow).toHaveAttribute('aria-pressed', 'false');

    // jsdom has no SpeechRecognition, so the toggle lands on the unsupported
    // failure path; any label change proves the click crossed the handle.
    await user.click(follow);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Follow mode: Follow' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /^Follow mode:/ })).toBeInTheDocument();
  });
});
