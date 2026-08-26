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
    renameFolder: vi.fn(),
    deleteFolder: vi.fn(),
    downloadSongPdf: vi.fn(),
    suggestFolder: vi.fn(),
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
    folder: null,
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

  it('clears the folder filter when switching to artists and back', async () => {
    vi.mocked(api.listSongs).mockResolvedValue([
      makeSong({ id: 1, title: 'Old Man', artist: 'Neil Young', folder: 'Setlist' }),
      makeSong({ id: 2, title: 'Miss Ohio', artist: 'Gillian Welch', folder: null }),
    ]);

    renderWithRouter(<LibraryTab />, { route: '/app/library' });
    await waitFor(() => expect(screen.getByText('Old Man')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('folder-pill-Setlist'));
    await waitFor(() => expect(screen.queryByText('Miss Ohio')).not.toBeInTheDocument());

    fireEvent.click(screen.getByTestId('browse-mode-artists'));
    await waitFor(() => expect(screen.getByTestId('artist-grid')).toBeInTheDocument());
    // Both artists are offered, so the folder is not still narrowing the list.
    expect(screen.getByTestId('artist-card-gillian welch')).toBeInTheDocument();

    // Folder pills belong to song mode only.
    expect(screen.queryByTestId('folder-pill-Setlist')).not.toBeInTheDocument();

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
});
