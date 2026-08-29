import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import type { AppShellContext } from '@/layouts/AppShell';
import type { Song } from '@/types';

const MOCK_SONG = vi.hoisted<Song>(() => ({
  id: 42,
  tags: [],
  uuid: 'test-uuid-123',
  user_id: 1,
  profile_id: 1,
  kind: 'chart',
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
}));

// Mock api module to return our test song
vi.mock('@/api', () => ({
  default: {
    listSongs: vi.fn().mockResolvedValue([MOCK_SONG]),
    getSong: vi.fn().mockResolvedValue(MOCK_SONG),
    getSongRevisions: vi.fn().mockResolvedValue([]),
    // The library asks which tabs are kept on the device to render its markers.
    keptSongFiles: vi.fn().mockResolvedValue(new Set()),
  },
  STORAGE_KEYS: {
    PROVIDER: 'test_provider',
    MODEL: 'test_model',
    REASONING_EFFORT: 'test_effort',
    CURRENT_SONG_ID: 'test_song_id',
    LAST_SURFACE: 'test_last_surface',
  },
}));

// Minimal context stub for LibraryTab
const stubContext: AppShellContext = {
  profile: { id: 1, is_default: true } as AppShellContext['profile'],
  llmSettings: { model: '', reasoning_effort: 'high' },
  rewriteResult: null,
  rewriteMeta: null,
  currentSongId: null,
  currentSongUuid: null,
  chatMessages: [],
  setChatMessages: vi.fn(),
  onNewRewrite: vi.fn(),
  onSongSaved: vi.fn(),
  onContentUpdated: vi.fn(),
  onOriginalContentUpdated: vi.fn(),
  onChangeModel: vi.fn(),
  reasoningEffort: 'high',
  onChangeReasoningEffort: vi.fn(),
  onOpenSettings: vi.fn(),
  isPremium: false,
  isAdmin: false,
  model: '',
  models: [],
  onSaveProfile: vi.fn(),
  onLoadSong: vi.fn(),
  parseLoading: false,
  parseResult: null,
  parsedContent: '',
  setParsedContent: vi.fn(),
  setParseResult: vi.fn(),
  parseStreamText: '',
  parseReasoningText: '',
  parseError: null,
  parseErrorType: undefined,
  setParseError: vi.fn(),
  onParse: vi.fn().mockResolvedValue(null),
  onCancelParse: vi.fn(),
  onClearParse: vi.fn(),
  onChatStreamingChange: vi.fn(),
  newSongNonce: 0,
};

/** Layout wrapper that provides AppShellContext via Outlet */
function ContextWrapper() {
  return <Outlet context={stubContext} />;
}

import LibraryTab from '@/components/LibraryTab';

describe('LibraryTab last-surface recording (issue #274)', () => {
  afterEach(() => {
    localStorage.removeItem('test_last_surface');
  });

  it('records the library as the surface a PWA relaunch should return to', async () => {
    localStorage.setItem('test_last_surface', 'workshop');

    render(
      <MemoryRouter initialEntries={['/app/library']}>
        <Routes>
          <Route path="/app" element={<ContextWrapper />}>
            <Route path="library" element={<LibraryTab />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    // Without this the library is the one surface that never registers, so a
    // stale 'workshop' survives and the relaunch reopens the rewrite editor.
    await waitFor(() => {
      expect(localStorage.getItem('test_last_surface')).toBe('library');
    });
  });
});
