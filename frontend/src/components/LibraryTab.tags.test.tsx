import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '@/test/test-utils';
import LibraryTab from '@/components/LibraryTab';
import type { AppShellContext } from '@/layouts/AppShell';
import type { Song, ChatMessage } from '@/types';

// Mock react-router-dom: provide useOutletContext + useParams
const mockOutletContext: Partial<AppShellContext> = {};
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useOutletContext: () => mockOutletContext,
    useParams: () => ({}),
  };
});

// Mock api module
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
  },
}));

// Mock sonner toast
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

describe('the tag pills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupContext();
  });

  const load = async (songs: Song[]) => {
    vi.mocked(api.listSongs).mockResolvedValue(songs);
    renderWithRouter(<LibraryTab />, { route: '/app/library' });
    await waitFor(() => expect(screen.getByText(songs[0]!.title as string)).toBeInTheDocument());
  };

  it('narrows the list to one tag, and says how many carry it', async () => {
    await load([
      makeSong({ id: 1, title: 'Song A', tags: ['Setlist'] }),
      makeSong({ id: 2, title: 'Song B', tags: ['Setlist'] }),
      makeSong({ id: 3, title: 'Song C' }),
    ]);

    expect(screen.getByTestId('tag-pill-Setlist')).toHaveTextContent('Setlist2');

    fireEvent.click(screen.getByTestId('tag-pill-Setlist'));

    await waitFor(() => expect(screen.queryByText('Song C')).not.toBeInTheDocument());
    expect(screen.getByText('Song A')).toBeInTheDocument();
    expect(screen.getByText('Song B')).toBeInTheDocument();
  });

  it('narrows to songs carrying every picked tag, not any of them', async () => {
    // The whole reason for many-tags-per-song. "Waltz" plus "Setlist" is the
    // question you actually have on stage; either-or is not.
    await load([
      makeSong({ id: 1, title: 'Both', tags: ['Setlist', 'Waltz'] }),
      makeSong({ id: 2, title: 'Only setlist', tags: ['Setlist'] }),
      makeSong({ id: 3, title: 'Only waltz', tags: ['Waltz'] }),
    ]);

    fireEvent.click(screen.getByTestId('tag-pill-Setlist'));
    fireEvent.click(screen.getByTestId('tag-pill-Waltz'));

    await waitFor(() => expect(screen.queryByText('Only setlist')).not.toBeInTheDocument());
    expect(screen.queryByText('Only waltz')).not.toBeInTheDocument();
    expect(screen.getByText('Both')).toBeInTheDocument();
  });

  it('unpicks a tag on a second tap, and All clears the lot', async () => {
    await load([
      makeSong({ id: 1, title: 'Both', tags: ['Setlist', 'Waltz'] }),
      makeSong({ id: 2, title: 'Only waltz', tags: ['Waltz'] }),
    ]);

    fireEvent.click(screen.getByTestId('tag-pill-Setlist'));
    fireEvent.click(screen.getByTestId('tag-pill-Waltz'));
    await waitFor(() => expect(screen.queryByText('Only waltz')).not.toBeInTheDocument());

    fireEvent.click(screen.getByTestId('tag-pill-Setlist'));
    await waitFor(() => expect(screen.getByText('Only waltz')).toBeInTheDocument());

    fireEvent.click(screen.getByText('All'));
    await waitFor(() => expect(screen.getByTestId('tag-pill-Waltz')).toHaveAttribute('aria-pressed', 'false'));
  });

  it('offers Untagged only when something is untagged', async () => {
    await load([
      makeSong({ id: 1, title: 'Song A', tags: ['Setlist'] }),
      makeSong({ id: 2, title: 'Song B' }),
    ]);

    fireEvent.click(screen.getByText('Untagged'));
    await waitFor(() => expect(screen.queryByText('Song A')).not.toBeInTheDocument());
    expect(screen.getByText('Song B')).toBeInTheDocument();
  });

  it('opens the tag menu from a visible button rather than a right-click', async () => {
    // The folder version opened this from onContextMenu, which a phone cannot
    // fire, so tags could not be renamed or deleted from the device most people
    // use this on.
    await load([makeSong({ id: 1, title: 'Song A', tags: ['Worship'] })]);

    await userEvent.click(screen.getByRole('button', { name: 'Actions for Worship' }));

    expect(await screen.findByText('Rename')).toBeInTheDocument();
    expect(screen.getByText('Delete tag')).toBeInTheDocument();
  });

  it('deletes a tag without touching the songs that carried it', async () => {
    // The thing folders could not do. Deleting a folder had to decide what
    // happened to its contents; a tag is not a container, so it does not.
    vi.mocked(api.deleteTag).mockResolvedValue(undefined as never);
    await load([makeSong({ id: 1, title: 'Song A', tags: ['Worship'] })]);

    await userEvent.click(screen.getByRole('button', { name: 'Actions for Worship' }));
    await userEvent.click(await screen.findByText('Delete tag'));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(api.deleteTag).toHaveBeenCalledWith('Worship'));
    expect(api.deleteSong).not.toHaveBeenCalled();
    expect(screen.getByText('Song A')).toBeInTheDocument();
  });
});

describe('tagging a song', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupContext();
  });

  const openMenu = async (song: Song, rest: Song[] = []) => {
    vi.mocked(api.listSongs).mockResolvedValue([song, ...rest]);
    renderWithRouter(<LibraryTab />, { route: '/app/library' });
    await waitFor(() => expect(screen.getByText(song.title as string)).toBeInTheDocument());
    await userEvent.click(screen.getAllByLabelText('Song actions')[0]!);
  };

  it('adds a tag from the song menu without removing the ones it has', async () => {
    const song = makeSong({ id: 1, title: 'Song A', tags: ['Waltz'] });
    vi.mocked(api.updateSong).mockResolvedValue({ ...song, tags: ['Waltz', 'Setlist'] });
    await openMenu(song, [makeSong({ id: 2, title: 'Song B', tags: ['Setlist'] })]);

    await userEvent.click(await screen.findByRole('menuitem', { name: /Setlist/ }));

    await waitFor(() =>
      expect(api.updateSong).toHaveBeenCalledWith(song.uuid, { tags: ['Waltz', 'Setlist'] }),
    );
  });

  it('takes a tag off again from the same menu entry', async () => {
    const song = makeSong({ id: 1, title: 'Song A', tags: ['Waltz'] });
    vi.mocked(api.updateSong).mockResolvedValue({ ...song, tags: [] });
    await openMenu(song);

    await userEvent.click(await screen.findByRole('menuitem', { name: /Waltz/ }));

    await waitFor(() => expect(api.updateSong).toHaveBeenCalledWith(song.uuid, { tags: [] }));
  });

  it('sets several tags in one save from the edit dialog', async () => {
    const song = makeSong({ id: 1, title: 'Song A', tags: ['Waltz'] });
    vi.mocked(api.updateSong).mockResolvedValue({ ...song, tags: ['Waltz', 'Setlist', 'Fiddle'] });
    await openMenu(song, [makeSong({ id: 2, title: 'Song B', tags: ['Setlist'] })]);

    await userEvent.click(await screen.findByText('Edit tags…'));
    await userEvent.click(await screen.findByRole('button', { name: 'Setlist' }));
    await userEvent.type(screen.getByLabelText('New tag'), 'Fiddle');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    // The typed tag counts even though Enter was never pressed. Losing it is the
    // kind of thing nobody reports and everybody notices.
    await waitFor(() =>
      expect(api.updateSong).toHaveBeenCalledWith(song.uuid, {
        tags: ['Waltz', 'Setlist', 'Fiddle'],
      }),
    );
  });
});

describe('AI tag suggestion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupContext();
  });

  async function openSongMenu(song: Song) {
    vi.mocked(api.listSongs).mockResolvedValue([song]);
    renderWithRouter(<LibraryTab />, { route: '/app/library' });
    await waitFor(() => expect(screen.getByText(song.title as string)).toBeInTheDocument());
    await userEvent.click(screen.getByLabelText('Song actions'));
    await screen.findByText('Suggest tags with AI…');
  }

  it('sits beside the manual tagging and spends nothing until asked', async () => {
    await openSongMenu(makeSong({ id: 1, title: 'Song A' }));

    await userEvent.click(screen.getByText('Suggest tags with AI…'));

    // Opening the offer must not call the endpoint: the credit is spent by the
    // button inside the dialog, not by browsing the menu.
    await waitFor(() => expect(screen.getByText('Uses 1 AI credit.')).toBeInTheDocument());
    expect(api.suggestTags).not.toHaveBeenCalled();
  });

  it('tags the chart only after the user applies the suggestions', async () => {
    const song = makeSong({ id: 1, title: 'Song A' });
    vi.mocked(api.suggestTags).mockResolvedValue([
      { tag: 'Hymns', count: 0 },
      { tag: 'Waltz', count: 3 },
    ]);
    vi.mocked(api.updateSong).mockResolvedValue({ ...song, tags: ['Hymns', 'Waltz'] });

    await openSongMenu(song);
    await userEvent.click(screen.getByText('Suggest tags with AI…'));
    await userEvent.click(await screen.findByRole('button', { name: 'Suggest tags' }));

    const apply = await screen.findByRole('button', { name: 'Add 2 tags' });
    expect(api.updateSong).not.toHaveBeenCalled();

    await userEvent.click(apply);
    await waitFor(() =>
      expect(api.updateSong).toHaveBeenCalledWith(song.uuid, { tags: ['Hymns', 'Waltz'] }),
    );
  });
});
