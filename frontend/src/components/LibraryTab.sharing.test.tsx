import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '@/test/test-utils';
import LibraryTab from '@/components/LibraryTab';
import type { AppShellContext } from '@/layouts/AppShell';
import type { Song, ChatMessage } from '@/types';

/**
 * Where the library hands off to the sharing seams.
 *
 * In OSS both seams render nothing, so there is no behaviour here to assert. What
 * there is, and what is worth pinning, is the placement: premium's overlay
 * replaces these components and depends on being called from these three spots
 * with these props. A refactor that drops one of them would take a premium
 * feature with it, and only premium CI builds the merged frontend.
 */

const mockOutletContext: Partial<AppShellContext> = {};
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useOutletContext: () => mockOutletContext, useParams: () => ({}) };
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
    keptSongFiles: vi.fn().mockResolvedValue(new Set()),
    keptSongFilesSize: vi.fn().mockResolvedValue(0),
    forgetSongFileOffline: vi.fn(),
  },
  STORAGE_KEYS: {
    DRAFT_INPUT: 'test_draft_input',
    DRAFT_INSTRUCTION: 'test_draft_instruction',
    SPLIT_PERCENT: 'test_split_pct',
    CURRENT_SONG_ID: 'test_current_song_id',
    LIBRARY_LAYOUT: 'test_library_layout',
    LIBRARY_BROWSE_MODE: 'test_library_browse_mode',
    LAST_SURFACE: 'test_last_surface',
  },
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), promise: vi.fn() } }));

/** Stands in for premium's implementation, recording how it was called. */
const shareActionCalls: { songUuids: string[]; variant: string }[] = [];
const shareNoticeCalls: { onSongsChanged?: () => void }[] = [];

vi.mock('@/extensions', async () => {
  const actual = await vi.importActual<typeof import('@/extensions')>('@/extensions');
  return {
    ...actual,
    SongShareAction: (props: { songUuids: string[]; variant: string; onSent?: () => void }) => {
      shareActionCalls.push({ songUuids: props.songUuids, variant: props.variant });
      return <div data-testid={`share-action-${props.variant}`} />;
    },
    SongShareNotice: (props: { onSongsChanged?: () => void }) => {
      shareNoticeCalls.push({ onSongsChanged: props.onSongsChanged });
      return <div data-testid="share-notice" />;
    },
  };
});

import api from '@/api';

function makeSong(overrides: Partial<Song> = {}): Song {
  return {
    id: 1,
    uuid: 'uuid-1',
    user_id: 1,
    profile_id: 1,
    kind: 'chart',
    title: 'Salt Creek',
    artist: 'Bill Monroe',
    original_content: 'G C G',
    rewritten_content: 'G C G',
    changes_summary: null,
    source_url: null,
    folder: null,
    font_size: null,
    status: 'ready',
    current_version: 1,
    created_at: '2026-08-29T00:00:00Z',
    updated_at: '2026-08-29T00:00:00Z',
    file: null,
    ...overrides,
  } as Song;
}

function setupContext() {
  Object.assign(mockOutletContext, {
    profile: { id: 1, user_id: 'u1', display_name: 'Test' },
    chatMessages: [] as ChatMessage[],
    setChatMessages: vi.fn(),
    onLoadSong: vi.fn(),
  });
}

describe('the sharing seams in the library', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    shareActionCalls.length = 0;
    shareNoticeCalls.length = 0;
    setupContext();
  });

  it('renders the inbox notice above the list, with a way to reload', async () => {
    vi.mocked(api.listSongs).mockResolvedValue([makeSong()]);
    renderWithRouter(<LibraryTab />, { route: '/app/library' });

    await waitFor(() => expect(screen.getByText('Salt Creek')).toBeInTheDocument());

    expect(screen.getByTestId('share-notice')).toBeInTheDocument();
    // Accepting a share creates songs in this library, so the notice has to be
    // able to tell the list to refetch.
    expect(typeof shareNoticeCalls[shareNoticeCalls.length - 1]?.onSongsChanged).toBe('function');
  });

  it('offers sending from a song menu, for that one song', async () => {
    vi.mocked(api.listSongs).mockResolvedValue([makeSong({ uuid: 'uuid-salt-creek' })]);
    renderWithRouter(<LibraryTab />, { route: '/app/library' });
    await waitFor(() => expect(screen.getByText('Salt Creek')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Song actions' }));

    const menuCall = shareActionCalls.find(c => c.variant === 'menu');
    expect(menuCall?.songUuids).toEqual(['uuid-salt-creek']);
  });

  it('offers sending from the selection toolbar, for everything selected', async () => {
    vi.mocked(api.listSongs).mockResolvedValue([
      makeSong({ id: 1, uuid: 'uuid-a', title: 'Salt Creek' }),
      makeSong({ id: 2, uuid: 'uuid-b', title: 'Big Sciota' }),
    ]);
    renderWithRouter(<LibraryTab />, { route: '/app/library' });
    await waitFor(() => expect(screen.getByText('Salt Creek')).toBeInTheDocument());

    // Selection mode is entered by ticking a card, not by a mode button.
    fireEvent.click(screen.getAllByRole('checkbox')[0]!);
    await waitFor(() => expect(screen.getByTestId('share-action-bulk')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Select All' }));

    const bulkCalls = shareActionCalls.filter(c => c.variant === 'bulk');
    const bulkCall = bulkCalls[bulkCalls.length - 1];
    expect(bulkCall?.songUuids.sort()).toEqual(['uuid-a', 'uuid-b']);
  });
});
