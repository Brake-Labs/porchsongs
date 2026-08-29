import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import api from '@/api';
import PlayPage from '@/pages/PlayPage';
import type { Song } from '@/types';

/**
 * The chord panel on the play route.
 *
 * What is checked here is the part that makes it more than a link to the chord
 * page: that it knows which chords the open chart uses, opens on one of them,
 * and keeps your place. How it sits next to the chart is a question about CSS
 * at two viewport widths, so that lives in the e2e suite where the widths are
 * real.
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
    PERFORMANCE_LAYOUT: 'test_perf_layout',
    PERFORMANCE_VERSION: 'test_perf_version',
    WAKE_LOCK: 'test_wake_lock',
    CHORD_INSTRUMENT: 'test_chord_instrument',
    CHORD_TUNING: 'test_chord_tuning',
    CHORD_PANEL_WIDTH: 'test_chord_panel_width',
  },
}));

vi.mock('@/components/TunerDialog', () => ({ default: () => null }));

// The chart itself is not what these tests are about, and the real one opens a
// mic for Follow.
vi.mock('@/components/PlayView', async () => {
  const actual = await vi.importActual<typeof import('@/components/PlayView')>(
    '@/components/PlayView',
  );
  return {
    ...actual,
    PerformanceSheet: ({ song, version }: { song: Song; version: string }) => (
      <div data-testid="sheet">
        {version === 'original' ? song.original_content : song.rewritten_content}
      </div>
    ),
  };
});

vi.mock('@/components/DocumentSheet', () => ({
  default: () => <div data-testid="document-sheet" />,
}));

const CHART = [
  '[Verse 1]',
  '[G]Amazing grace how [C]sweet the sound',
  'That [G]saved a wretch like [D7]me',
].join('\n');

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
    folder: null,
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

/** The panel, once it is open. */
function panel(): HTMLElement {
  return screen.getByRole('complementary');
}

/** The row of chords the chart uses, which is only rendered when there are any. */
function songChordRow(): HTMLElement | null {
  return screen.queryByRole('heading', { name: 'In this song' })?.parentElement ?? null;
}

/** The chord the explorer is currently showing, read off its heading. */
function shownChord(): string {
  const headings = within(panel()).getAllByRole('heading', { level: 2 });
  // The panel's own "Chords" heading comes first; the explorer's is the chord.
  return headings[headings.length - 1]!.textContent ?? '';
}

async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Chords' }));
  await waitFor(() => expect(screen.getByRole('complementary')).toBeInTheDocument());
}

describe('PlayPage chord panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetSong.mockResolvedValue(makeSong());
  });

  it('is closed until asked for, so the chart gets the whole surface', async () => {
    renderPlay();
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeInTheDocument());

    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chords' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('lists the chords this chart uses', async () => {
    const user = userEvent.setup();
    renderPlay();
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeInTheDocument());
    await openPanel(user);

    const row = songChordRow();
    expect(row).not.toBeNull();
    expect(within(row!).getByRole('button', { name: 'G' })).toBeInTheDocument();
    expect(within(row!).getByRole('button', { name: 'C' })).toBeInTheDocument();
    expect(within(row!).getByRole('button', { name: 'D7' })).toBeInTheDocument();
  });

  it('opens on the first chord of the chart, not on a default', async () => {
    // Without this the panel opens on C every time, and finding the chord you
    // are actually playing is a hunt through a twelve by fourteen grid.
    const user = userEvent.setup();
    renderPlay();
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeInTheDocument());
    await openPanel(user);

    expect(shownChord()).toBe('G');
  });

  it('jumps to a chord tapped in the row', async () => {
    const user = userEvent.setup();
    renderPlay();
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeInTheDocument());
    await openPanel(user);

    await user.click(within(songChordRow()!).getByRole('button', { name: 'D7' }));
    expect(shownChord()).toBe('D7');
    expect(within(songChordRow()!).getByRole('button', { name: 'D7' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('keeps your place when you close it and open it again', async () => {
    // Closing it to read the words and opening it again is the normal way to
    // use this. Landing back on the first chord every time would undo the work.
    const user = userEvent.setup();
    renderPlay();
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeInTheDocument());
    await openPanel(user);

    await user.click(within(songChordRow()!).getByRole('button', { name: 'D7' }));
    await user.click(screen.getByLabelText('Close chords'));
    await waitFor(() => expect(screen.queryByRole('complementary')).not.toBeInTheDocument());

    await openPanel(user);
    expect(shownChord()).toBe('D7');
  });

  it('hands focus back to the button that opened it', async () => {
    // The close button is the element focus is sitting on when it unmounts, and
    // the browser drops focus to <body> from there, so a keyboard user's next
    // Tab restarts at the top of the surface instead of where they were.
    const user = userEvent.setup();
    renderPlay();
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeInTheDocument());
    await openPanel(user);

    await user.click(screen.getByLabelText('Close chords'));
    await waitFor(() => expect(screen.queryByRole('complementary')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Chords' })).toHaveFocus();
  });

  it('closes on Escape pressed inside it', async () => {
    const user = userEvent.setup();
    renderPlay();
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeInTheDocument());
    await openPanel(user);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('complementary')).not.toBeInTheDocument());
  });

  it('remembers the instrument, because a player owns one of them', async () => {
    const user = userEvent.setup();
    const first = renderPlay();
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeInTheDocument());
    await openPanel(user);

    await user.click(within(panel()).getByRole('button', { name: 'Ukulele' }));
    expect(localStorage.getItem('test_chord_instrument')).toBe('ukulele');

    first.unmount();
    renderPlay();
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeInTheDocument());
    await openPanel(user);

    expect(within(panel()).getByRole('button', { name: 'Ukulele' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('does not carry a stored tuning onto an instrument that has no such thing', async () => {
    // "baritone" is a ukulele tuning. Restoring it against a guitar would put
    // the panel in a state the picker cannot show.
    localStorage.setItem('test_chord_instrument', 'guitar');
    localStorage.setItem('test_chord_tuning', 'baritone');
    const user = userEvent.setup();
    renderPlay();
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeInTheDocument());
    await openPanel(user);

    // The panel collapses the tunings into one select, so the fallback shows as
    // the select's value rather than a pressed button.
    expect(within(panel()).getByRole('combobox', { name: 'Tuning' })).toHaveValue('standard');
  });

  it('reads the chords from whichever version is on screen', async () => {
    const user = userEvent.setup();
    mockGetSong.mockResolvedValue(
      makeSong({
        original_content: '[Bb]Different [Eb]chords entirely',
        rewritten_content: CHART,
      }),
    );
    renderPlay();
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeInTheDocument());
    await openPanel(user);
    expect(within(songChordRow()!).getByRole('button', { name: 'G' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Original' }));

    await waitFor(() =>
      expect(within(songChordRow()!).getByRole('button', { name: 'Bb' })).toBeInTheDocument(),
    );
    expect(within(songChordRow()!).queryByRole('button', { name: 'G' })).not.toBeInTheDocument();
  });

  it('puts the instrument above the chords, since it decides what they mean', async () => {
    // A G shape on a ukulele is not a G shape on a guitar. Picking the wrong
    // instrument makes every diagram below wrong, including the ones reached
    // from the row of this song's chords, so it is the first thing in the panel.
    const user = userEvent.setup();
    renderPlay();
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeInTheDocument());
    await openPanel(user);

    const instrument = within(panel()).getByRole('group', { name: 'Instrument' });
    const songRow = screen.getByRole('heading', { name: 'In this song' });
    // Node.DOCUMENT_POSITION_FOLLOWING: the song row comes after the picker.
    expect(instrument.compareDocumentPosition(songRow) & 4).toBeTruthy();
  });

  it('is dragged wider from its left edge, and remembers', async () => {
    const user = userEvent.setup();
    renderPlay();
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeInTheDocument());
    await openPanel(user);

    const handle = screen.getByRole('separator', { name: 'Resize chord panel' });
    const before = Number(handle.getAttribute('aria-valuenow'));

    // The keyboard path, which is the same setter the pointer drag uses and the
    // one jsdom can actually drive. Left widens, because the panel is on the
    // right.
    handle.focus();
    await user.keyboard('{ArrowLeft}');
    const after = Number(handle.getAttribute('aria-valuenow'));

    expect(after).toBeGreaterThan(before);
    expect(localStorage.getItem('test_chord_panel_width')).toBe(String(after));
    expect(panel().style.getPropertyValue('--chord-panel-width')).toBe(`${after}px`);
  });

  it('will not be dragged so wide that the chart has nowhere to go', async () => {
    const user = userEvent.setup();
    renderPlay();
    await waitFor(() => expect(screen.getByTestId('sheet')).toBeInTheDocument());
    await openPanel(user);

    const handle = screen.getByRole('separator', { name: 'Resize chord panel' });
    handle.focus();
    for (let i = 0; i < 80; i++) await user.keyboard('{ArrowLeft}');

    const width = Number(handle.getAttribute('aria-valuenow'));
    expect(width).toBeLessThanOrEqual(Number(handle.getAttribute('aria-valuemax')));
    // jsdom reports a 1024px window, so the chart's floor is the binding limit.
    expect(width).toBeLessThanOrEqual(window.innerWidth - 360);
  });

  it('offers the dictionary on a tab, which has no chords to read', async () => {
    // A stored PDF is exactly when you want to look a chord up, and exactly
    // when there is no text to pull one out of.
    const user = userEvent.setup();
    mockGetSong.mockResolvedValue(
      makeSong({
        kind: 'document',
        original_content: '',
        rewritten_content: '',
        file: {
          filename: 'tab.pdf',
          content_type: 'application/pdf',
          size_bytes: 10,
          page_count: 1,
          sha256: 'a'.repeat(64),
        },
      } as Partial<Song>),
    );
    (api.fetchSongFile as ReturnType<typeof vi.fn>).mockResolvedValue(new ArrayBuffer(10));

    renderPlay();
    await waitFor(() => expect(screen.getByTestId('document-sheet')).toBeInTheDocument());
    await openPanel(user);

    expect(songChordRow()).toBeNull();
    // The picker is still there, opened on the fallback chord.
    expect(within(panel()).getByRole('button', { name: 'Guitar' })).toBeInTheDocument();
    expect(shownChord()).toBe('C');
  });
});
