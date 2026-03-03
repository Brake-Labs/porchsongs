import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithRouter } from '@/test/test-utils';
import LibraryTab from '@/components/LibraryTab';
import type { AppShellContext } from '@/layouts/AppShell';
import type { Song, ChatMessage, SavedModel } from '@/types';

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
    renameFolder: vi.fn(),
    deleteFolder: vi.fn(),
    downloadSongPdf: vi.fn(),
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
vi.mock('@/components/MidiDialog', () => ({ default: () => null }));

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
    llmSettings: { provider: 'openai', model: 'gpt-4o', reasoning_effort: 'high' },
    rewriteResult: null,
    rewriteMeta: null,
    currentSongId: null,
    currentSongUuid: null,
    chatMessages: [] as ChatMessage[],
    setChatMessages: vi.fn(),
    onNewRewrite: vi.fn(),
    onSongSaved: vi.fn(),
    onContentUpdated: vi.fn(),
    onChangeProvider: vi.fn(),
    onChangeModel: vi.fn(),
    reasoningEffort: 'high',
    onChangeReasoningEffort: vi.fn(),
    savedModels: [] as SavedModel[],
    onOpenSettings: vi.fn(),
    onLoadSong: vi.fn(),
    ...overrides,
  });
}

describe('LibraryTab folder pills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupContext();
  });

  it('clicking a folder pill filters songs without showing a dropdown menu', async () => {
    const songs = [
      makeSong({ id: 1, title: 'Song A', folder: 'Setlist' }),
      makeSong({ id: 2, title: 'Song B', folder: 'Setlist' }),
      makeSong({ id: 3, title: 'Song C', folder: null }),
    ];
    vi.mocked(api.listSongs).mockResolvedValue(songs);

    renderWithRouter(<LibraryTab />, { route: '/app/library' });

    // Wait for songs to load
    await waitFor(() => {
      expect(screen.getByText('Song A')).toBeInTheDocument();
    });

    // All three songs should be visible initially
    expect(screen.getByText('Song A')).toBeInTheDocument();
    expect(screen.getByText('Song B')).toBeInTheDocument();
    expect(screen.getByText('Song C')).toBeInTheDocument();

    // Click the "Setlist" folder pill
    const folderPill = screen.getByTestId('folder-pill-Setlist');
    fireEvent.click(folderPill);

    // After clicking, only Setlist songs should be visible
    await waitFor(() => {
      expect(screen.queryByText('Song C')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Song A')).toBeInTheDocument();
    expect(screen.getByText('Song B')).toBeInTheDocument();

    // The dropdown menu should NOT appear: no "Rename" or "Delete folder" visible
    expect(screen.queryByText('Rename')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete folder')).not.toBeInTheDocument();
  });

  it('right-clicking a folder pill opens the context dropdown menu', async () => {
    const songs = [
      makeSong({ id: 1, title: 'Song A', folder: 'Worship' }),
    ];
    vi.mocked(api.listSongs).mockResolvedValue(songs);

    renderWithRouter(<LibraryTab />, { route: '/app/library' });

    await waitFor(() => {
      expect(screen.getByText('Song A')).toBeInTheDocument();
    });

    // Right-click the "Worship" folder pill
    const folderPill = screen.getByTestId('folder-pill-Worship');
    fireEvent.contextMenu(folderPill);

    // The dropdown menu should now be open with Rename and Delete
    await waitFor(() => {
      expect(screen.getByText('Rename')).toBeInTheDocument();
    });
    expect(screen.getByText('Delete folder')).toBeInTheDocument();
  });
});
