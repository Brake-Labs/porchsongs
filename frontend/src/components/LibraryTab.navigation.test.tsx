import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Outlet, useNavigate } from 'react-router-dom';
import type { AppShellContext } from '@/layouts/AppShell';
import type { Song } from '@/types';

const MOCK_SONG = vi.hoisted<Song>(() => ({
  id: 42,
  uuid: 'test-uuid-123',
  user_id: 1,
  profile_id: 1,
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
  },
  STORAGE_KEYS: {
    PROVIDER: 'test_provider',
    MODEL: 'test_model',
    REASONING_EFFORT: 'test_effort',
    CURRENT_SONG_ID: 'test_song_id',
  },
}));

// Minimal context stub for LibraryTab
const stubContext: AppShellContext = {
  profile: { id: 1, is_default: true } as AppShellContext['profile'],
  llmSettings: { provider: '', model: '', reasoning_effort: 'high' },
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
  onChangeProvider: vi.fn(),
  onChangeModel: vi.fn(),
  reasoningEffort: 'high',
  onChangeReasoningEffort: vi.fn(),
  savedModels: [],
  onOpenSettings: vi.fn(),
  isPremium: false,
  isAdmin: false,
  provider: '',
  model: '',
  onSave: vi.fn(),
  onAddModel: vi.fn() as AppShellContext['onAddModel'],
  onRemoveModel: vi.fn() as AppShellContext['onRemoveModel'],
  connections: [],
  onAddConnection: vi.fn() as AppShellContext['onAddConnection'],
  onRemoveConnection: vi.fn(),
  onSaveProfile: vi.fn(),
  onLoadSong: vi.fn(),
};

/** Layout wrapper that provides AppShellContext via Outlet */
function ContextWrapper() {
  return <Outlet context={stubContext} />;
}

/** Button that navigates to /app/library, simulating a tab click */
function NavButton() {
  const navigate = useNavigate();
  return (
    <button data-testid="go-library" onClick={() => navigate('/app/library')}>
      Library Tab
    </button>
  );
}

import LibraryTab from '@/components/LibraryTab';

describe('LibraryTab navigation (issue #94)', () => {
  it('returns to song list when navigating from /app/library/:id to /app/library', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/app/library/test-uuid-123']}>
        <NavButton />
        <Routes>
          <Route path="/app" element={<ContextWrapper />}>
            <Route path="library" element={<LibraryTab />} />
            <Route path="library/:id" element={<LibraryTab />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    // Wait for the song detail view to render (shows the song title as heading)
    await waitFor(() => {
      expect(screen.getByText('Amazing Grace')).toBeInTheDocument();
    });

    // The "All Songs" back button should be visible (detail view indicator)
    expect(screen.getByRole('button', { name: /all songs/i })).toBeInTheDocument();

    // Click the Library tab (simulated via NavButton navigating to /app/library)
    await user.click(screen.getByTestId('go-library'));

    // After navigating to /app/library, the detail view should be gone
    // and we should see the song list instead
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /all songs/i })).not.toBeInTheDocument();
    });
  });
});
