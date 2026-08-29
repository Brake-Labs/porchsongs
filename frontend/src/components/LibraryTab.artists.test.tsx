import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '@/test/test-utils';
import LibraryTab, { groupSongsByArtist } from '@/components/LibraryTab';
import type { AppShellContext } from '@/layouts/AppShell';
import type { Song, ChatMessage } from '@/types';

const mockOutletContext: Partial<AppShellContext> = {};
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useOutletContext: () => mockOutletContext,
    useParams: () => ({}),
  };
});

vi.mock('@/api', () => ({
  default: {
    listSongs: vi.fn(),
    updateSong: vi.fn(),
    deleteSong: vi.fn(),
    getSongRevisions: vi.fn(),
    renameTag: vi.fn(),
    deleteTag: vi.fn(),
    downloadSongPdf: vi.fn(),
    suggestTags: vi.fn(),
    // The library asks which tabs are kept on the device to render its markers.
    keptSongFiles: vi.fn().mockResolvedValue(new Set()),
  },
  STORAGE_KEYS: {
    DRAFT_INPUT: 'test_draft_input',
    DRAFT_INSTRUCTION: 'test_draft_instruction',
    SPLIT_PERCENT: 'test_split_pct',
    CURRENT_SONG_ID: 'test_current_song_id',
    LIBRARY_LAYOUT: 'test_library_layout',
    LIBRARY_BROWSE_MODE: 'test_library_browse_mode',
    LAST_SURFACE: 'test_last_surface',
    PERFORMANCE_LAYOUT: 'test_performance_layout',
    PERFORMANCE_VERSION: 'test_performance_version',
  },
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), promise: vi.fn() },
}));

import api from '@/api';

function makeSong(overrides: Partial<Song> = {}): Song {
  return {
    id: 1,
    uuid: `test-uuid-${String(overrides.id ?? 1)}`,
    user_id: 1,
    profile_id: 1,
    title: 'Test Song',
    artist: 'Test Artist',
    source_url: null,
    original_content: 'Original lyrics',
    rewritten_content: 'Rewritten lyrics',
    changes_summary: null,
    llm_provider: null,
    llm_model: null,
    font_size: null,
    tags: [],
    status: 'completed',
    current_version: 1,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  } as Song;
}

function setupContext(overrides: Partial<AppShellContext> = {}): void {
  Object.assign(mockOutletContext, {
    profile: { id: 1, user_id: 'u1', display_name: 'Test', parse_prompt: '', chat_prompt: '' },
    llmSettings: { model: 'gpt-4o', reasoning_effort: 'high' },
    rewriteResult: null,
    rewriteMeta: null,
    currentSongId: null,
    currentSongUuid: null,
    chatMessages: [] as ChatMessage[],
    setChatMessages: vi.fn(),
    onNewRewrite: vi.fn(),
    onSongSaved: vi.fn(),
    onContentUpdated: vi.fn(),
    onChangeModel: vi.fn(),
    reasoningEffort: 'high',
    onChangeReasoningEffort: vi.fn(),
    models: [] as string[],
    onOpenSettings: vi.fn(),
    onLoadSong: vi.fn(),
    ...overrides,
  });
}

/** Renders the library and switches it into artist mode once songs have loaded. */
async function renderInArtistMode(songs: Song[]) {
  vi.mocked(api.listSongs).mockResolvedValue(songs);
  renderWithRouter(<LibraryTab />, { route: '/app/library' });
  await waitFor(() => {
    expect(screen.getByTestId('browse-mode-artists')).toBeInTheDocument();
  });
  fireEvent.click(screen.getByTestId('browse-mode-artists'));
  await waitFor(() => {
    expect(screen.getByTestId('artist-grid')).toBeInTheDocument();
  });
}

describe('groupSongsByArtist', () => {
  it('groups spellings that differ only by case or surrounding space', () => {
    const groups = groupSongsByArtist([
      makeSong({ id: 1, artist: 'Neil Young' }),
      makeSong({ id: 2, artist: 'neil young' }),
      makeSong({ id: 3, artist: '  Neil Young  ' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.count).toBe(3);
    // Two songs spell it "Neil Young", one spells it "neil young".
    expect(groups[0]?.name).toBe('Neil Young');
  });

  it('breaks a spelling tie alphabetically rather than by load order', () => {
    const forwards = groupSongsByArtist([
      makeSong({ id: 1, artist: 'Neil Young' }),
      makeSong({ id: 2, artist: 'neil young' }),
    ]);
    const backwards = groupSongsByArtist([
      makeSong({ id: 1, artist: 'neil young' }),
      makeSong({ id: 2, artist: 'Neil Young' }),
    ]);

    expect(forwards[0]?.name).toBe('Neil Young');
    expect(backwards[0]?.name).toBe('Neil Young');
  });

  it('collapses runs of whitespace inside a name, not just around it', () => {
    const groups = groupSongsByArtist([
      makeSong({ id: 1, artist: 'Neil Young' }),
      makeSong({ id: 2, artist: 'Neil  Young' }),
      makeSong({ id: 3, artist: 'Neil\tYoung' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.count).toBe(3);
    expect(groups[0]?.name).toBe('Neil Young');
  });

  it('buckets null and blank artists under Unknown artist', () => {
    const groups = groupSongsByArtist([
      makeSong({ id: 1, artist: null }),
      makeSong({ id: 2, artist: '   ' }),
      makeSong({ id: 3, artist: 'Gillian Welch' }),
    ]);

    const unknown = groups.find(g => g.name === 'Unknown artist');
    expect(unknown?.count).toBe(2);
    expect(groups.find(g => g.name === 'Gillian Welch')?.count).toBe(1);
  });
});

describe('LibraryTab artist browsing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    setupContext();
  });

  it('starts in song mode and shows every song', async () => {
    vi.mocked(api.listSongs).mockResolvedValue([
      makeSong({ id: 1, title: 'Old Man', artist: 'Neil Young' }),
      makeSong({ id: 2, title: 'Miss Ohio', artist: 'Gillian Welch' }),
    ]);

    renderWithRouter(<LibraryTab />, { route: '/app/library' });

    await waitFor(() => expect(screen.getByText('Old Man')).toBeInTheDocument());
    expect(screen.getByText('Miss Ohio')).toBeInTheDocument();
    expect(screen.queryByTestId('artist-grid')).not.toBeInTheDocument();
  });

  it('shows one card per artist with a chart count, then drills into one', async () => {
    await renderInArtistMode([
      makeSong({ id: 1, title: 'Old Man', artist: 'Neil Young' }),
      makeSong({ id: 2, title: 'Harvest Moon', artist: 'Neil Young' }),
      makeSong({ id: 3, title: 'Miss Ohio', artist: 'Gillian Welch' }),
    ]);

    // The picker replaces the song list entirely.
    expect(screen.queryByText('Old Man')).not.toBeInTheDocument();
    expect(screen.getByTestId('artist-card-neil young')).toHaveTextContent('2 charts');
    expect(screen.getByTestId('artist-card-gillian welch')).toHaveTextContent('1 chart');

    fireEvent.click(screen.getByTestId('artist-card-neil young'));

    await waitFor(() => expect(screen.getByText('Old Man')).toBeInTheDocument());
    expect(screen.getByText('Harvest Moon')).toBeInTheDocument();
    expect(screen.queryByText('Miss Ohio')).not.toBeInTheDocument();
    expect(screen.queryByTestId('artist-grid')).not.toBeInTheDocument();
  });

  it('returns to the picker from the breadcrumb', async () => {
    await renderInArtistMode([
      makeSong({ id: 1, title: 'Old Man', artist: 'Neil Young' }),
      makeSong({ id: 2, title: 'Miss Ohio', artist: 'Gillian Welch' }),
    ]);

    fireEvent.click(screen.getByTestId('artist-card-neil young'));
    await waitFor(() => expect(screen.getByText('Old Man')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('artist-back'));

    await waitFor(() => expect(screen.getByTestId('artist-grid')).toBeInTheDocument());
    expect(screen.queryByText('Old Man')).not.toBeInTheDocument();
  });

  it('drills into an artist by keyboard', async () => {
    await renderInArtistMode([
      makeSong({ id: 1, title: 'Old Man', artist: 'Neil Young' }),
    ]);

    fireEvent.keyDown(screen.getByTestId('artist-card-neil young'), { key: 'Enter' });

    await waitFor(() => expect(screen.getByText('Old Man')).toBeInTheDocument());
  });

  it('searches artist names in the picker, not song titles', async () => {
    await renderInArtistMode([
      makeSong({ id: 1, title: 'Old Man', artist: 'Neil Young' }),
      makeSong({ id: 2, title: 'Miss Ohio', artist: 'Gillian Welch' }),
    ]);

    fireEvent.change(screen.getByPlaceholderText('Search artists...'), {
      target: { value: 'gill' },
    });

    await waitFor(() => {
      expect(screen.queryByTestId('artist-card-neil young')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('artist-card-gillian welch')).toBeInTheDocument();

    // A song title is not an artist name, so it matches nothing here.
    fireEvent.change(screen.getByPlaceholderText('Search artists...'), {
      target: { value: 'Old Man' },
    });

    await waitFor(() => {
      expect(screen.getByText('No artists match your search.')).toBeInTheDocument();
    });
  });

  it('sorts artists by name ascending by default, and by chart count when asked', async () => {
    await renderInArtistMode([
      makeSong({ id: 1, artist: 'Aoife Donovan' }),
      makeSong({ id: 2, artist: 'Zoe Keating' }),
      makeSong({ id: 3, artist: 'Zoe Keating' }),
    ]);

    const names = () =>
      [...screen.getByTestId('artist-grid').children].map(el => el.querySelector('h3')?.textContent);

    // The song list defaults to descending (newest created first). An A-to-Z list
    // of artists must not inherit that and open at Z.
    expect(names()).toEqual(['Aoife Donovan', 'Zoe Keating']);

    // Picking "Charts" means most charts first, so the direction follows the key.
    fireEvent.change(screen.getByLabelText('Sort artists by'), { target: { value: 'count' } });

    await waitFor(() => expect(names()).toEqual(['Zoe Keating', 'Aoife Donovan']));
  });

  it('keeps equal-count artists alphabetical whichever way the count sort points', async () => {
    await renderInArtistMode([
      makeSong({ id: 1, artist: 'Zoe Keating' }),
      makeSong({ id: 2, artist: 'Aoife Donovan' }),
      makeSong({ id: 3, artist: 'Marisa Anderson' }),
    ]);

    const names = () =>
      [...screen.getByTestId('artist-grid').children].map(el => el.querySelector('h3')?.textContent);

    fireEvent.change(screen.getByLabelText('Sort artists by'), { target: { value: 'count' } });
    // All three hold one chart, so the count decides nothing and the names do.
    await waitFor(() => expect(names()).toEqual(['Aoife Donovan', 'Marisa Anderson', 'Zoe Keating']));

    // Reversing asks about counts. It must not also reverse the name tiebreak,
    // which would look like the list shuffling for no reason.
    fireEvent.click(screen.getByLabelText('Sort descending'));

    await waitFor(() => expect(names()).toEqual(['Aoife Donovan', 'Marisa Anderson', 'Zoe Keating']));
  });

  it('keeps Unknown artist last whichever way the sort points', async () => {
    await renderInArtistMode([
      makeSong({ id: 1, artist: null }),
      makeSong({ id: 2, artist: null }),
      makeSong({ id: 3, artist: null }),
      makeSong({ id: 4, artist: 'Aoife Donovan' }),
    ]);

    const lastName = () => {
      const cards = [...screen.getByTestId('artist-grid').children];
      return cards[cards.length - 1]?.querySelector('h3')?.textContent;
    };

    expect(lastName()).toBe('Unknown artist');

    // Reversing the sort would otherwise float the three-chart bucket to the top.
    fireEvent.click(screen.getByLabelText('Sort ascending'));

    await waitFor(() => expect(lastName()).toBe('Unknown artist'));
  });

  it('clears the tag filter when switching to artists and back', async () => {
    vi.mocked(api.listSongs).mockResolvedValue([
      makeSong({ id: 1, title: 'Old Man', artist: 'Neil Young', tags: ['Setlist'] }),
      makeSong({ id: 2, title: 'Miss Ohio', artist: 'Gillian Welch', tags: [] }),
    ]);

    renderWithRouter(<LibraryTab />, { route: '/app/library' });
    await waitFor(() => expect(screen.getByText('Old Man')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('tag-pill-Setlist'));
    await waitFor(() => expect(screen.queryByText('Miss Ohio')).not.toBeInTheDocument());

    fireEvent.click(screen.getByTestId('browse-mode-artists'));
    await waitFor(() => expect(screen.getByTestId('artist-grid')).toBeInTheDocument());
    // Both artists are offered, so the tag is not still narrowing the list.
    expect(screen.getByTestId('artist-card-gillian welch')).toBeInTheDocument();

    // Tag pills belong to song mode only.
    expect(screen.queryByTestId('tag-pill-Setlist')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('browse-mode-songs'));
    await waitFor(() => expect(screen.getByText('Miss Ohio')).toBeInTheDocument());
    expect(screen.getByText('Old Man')).toBeInTheDocument();
  });

  it('falls back to the picker when the drilled-into artist loses its last chart', async () => {
    await renderInArtistMode([
      makeSong({ id: 1, title: 'Old Man', artist: 'Neil Young' }),
      makeSong({ id: 2, title: 'Miss Ohio', artist: 'Gillian Welch' }),
    ]);

    fireEvent.click(screen.getByTestId('artist-card-neil young'));
    await waitFor(() => expect(screen.getByText('Old Man')).toBeInTheDocument());

    vi.mocked(api.deleteSong).mockResolvedValue(undefined as unknown as void);
    await userEvent.click(screen.getByLabelText('Song actions'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.getByTestId('artist-grid')).toBeInTheDocument());
    expect(screen.queryByTestId('artist-card-neil young')).not.toBeInTheDocument();
  });

  it('remembers the browse mode across mounts', async () => {
    await renderInArtistMode([makeSong({ id: 1, artist: 'Neil Young' })]);

    expect(localStorage.getItem('test_library_browse_mode')).toBe('artists');
  });

  it('drills into the Unknown artist bucket', async () => {
    await renderInArtistMode([
      makeSong({ id: 1, title: 'Caleb Meyer', artist: null }),
      makeSong({ id: 2, title: 'Helpless', artist: '   ' }),
      makeSong({ id: 3, title: 'Old Man', artist: 'Neil Young' }),
    ]);

    fireEvent.click(screen.getByText('Unknown artist'));

    await waitFor(() => expect(screen.getByText('Caleb Meyer')).toBeInTheDocument());
    expect(screen.getByText('Helpless')).toBeInTheDocument();
    expect(screen.queryByText('Old Man')).not.toBeInTheDocument();
    // The breadcrumb has to name the bucket, not fall through to a blank label.
    expect(screen.getByTestId('artist-back')).toBeInTheDocument();
  });

  it('clears the search box when an artist is picked', async () => {
    await renderInArtistMode([
      makeSong({ id: 1, title: 'Old Man', artist: 'Neil Young' }),
      makeSong({ id: 2, title: 'Miss Ohio', artist: 'Gillian Welch' }),
    ]);

    fireEvent.change(screen.getByPlaceholderText('Search artists...'), {
      target: { value: 'neil' },
    });
    await waitFor(() => {
      expect(screen.queryByTestId('artist-card-gillian welch')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('artist-card-neil young'));

    // The query that found the artist must not go on to filter their charts.
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search songs by title or artist...')).toHaveValue('');
    });
    expect(screen.getByText('Old Man')).toBeInTheDocument();
  });

  it('sorts the drilled-into artist\'s songs with the shared direction button', async () => {
    await renderInArtistMode([
      makeSong({ id: 1, title: 'Old Man', artist: 'Neil Young', created_at: '2025-01-01T00:00:00Z' }),
      makeSong({ id: 2, title: 'Harvest Moon', artist: 'Neil Young', created_at: '2025-02-01T00:00:00Z' }),
    ]);

    fireEvent.click(screen.getByTestId('artist-card-neil young'));
    await waitFor(() => expect(screen.getByText('Old Man')).toBeInTheDocument());

    const titles = () =>
      screen.getAllByRole('heading', { level: 3 }).map(el => el.textContent?.split(' by ')[0]);

    // Drilling in leaves the song list on its own default of newest created first.
    expect(titles()).toEqual(['Harvest Moon', 'Old Man']);

    fireEvent.click(screen.getByLabelText('Sort descending'));

    await waitFor(() => expect(titles()).toEqual(['Old Man', 'Harvest Moon']));
  });

  it('opens in the picker when the stored mode is artists', async () => {
    localStorage.setItem('test_library_browse_mode', 'artists');
    vi.mocked(api.listSongs).mockResolvedValue([
      makeSong({ id: 1, title: 'Old Man', artist: 'Neil Young' }),
    ]);

    renderWithRouter(<LibraryTab />, { route: '/app/library' });

    await waitFor(() => expect(screen.getByTestId('artist-grid')).toBeInTheDocument());
    expect(screen.queryByText('Old Man')).not.toBeInTheDocument();
  });

  it('leaves the search box and tag filter alone when the current mode is tapped', async () => {
    vi.mocked(api.listSongs).mockResolvedValue([
      makeSong({ id: 1, title: 'Old Man', artist: 'Neil Young', tags: ['Setlist'] }),
      makeSong({ id: 2, title: 'Miss Ohio', artist: 'Gillian Welch', tags: [] }),
    ]);

    renderWithRouter(<LibraryTab />, { route: '/app/library' });
    await waitFor(() => expect(screen.getByText('Old Man')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('tag-pill-Setlist'));
    const search = () => screen.getByPlaceholderText('Search songs by title or artist...');
    fireEvent.change(search(), { target: { value: 'Old' } });
    await waitFor(() => expect(search()).toHaveValue('Old'));

    // Tapping the half that is already lit must not behave like a mode switch.
    fireEvent.click(screen.getByTestId('browse-mode-songs'));

    await waitFor(() => expect(search()).toHaveValue('Old'));
    expect(screen.queryByText('Miss Ohio')).not.toBeInTheDocument();
    expect(screen.getByTestId('tag-pill-Setlist')).toBeInTheDocument();
  });

  // The switch used to lead the tag row, where an active "Songs" and an
  // active "All" were the same brown pill side by side, so a mode switch and a
  // tag filter read as one set of options with two of them chosen.
  it('keeps the browse switch out of the tag filter row', async () => {
    vi.mocked(api.listSongs).mockResolvedValue([
      makeSong({ id: 1, title: 'Old Man', artist: 'Neil Young', tags: ['Setlist'] }),
    ]);

    renderWithRouter(<LibraryTab />, { route: '/app/library' });
    await waitFor(() => expect(screen.getByText('Old Man')).toBeInTheDocument());

    const tagRow = screen.getByTestId('tag-pill-Setlist').parentElement!;
    expect(tagRow).not.toContainElement(screen.getByTestId('browse-mode-songs'));
  });

  it('drops the tag filter row entirely in the artist picker', async () => {
    await renderInArtistMode([
      makeSong({ id: 1, title: 'Old Man', artist: 'Neil Young', tags: ['Setlist'] }),
    ]);

    // Nothing in that row applies to a list of artists, and an empty strip of
    // controls between the search box and the grid is just a gap with a border.
    expect(screen.queryByTestId('tag-pill-Setlist')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make a new tag' })).not.toBeInTheDocument();
  });
});
