import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import type { AppShellContext } from '@/layouts/AppShell';
import type { Song } from '@/types';

// A song whose original and edited versions differ, so the version toggle shows.
const EDITED_SONG = vi.hoisted<Song>(() => ({
  id: 7,
  uuid: 'edited-uuid',
  user_id: 1,
  profile_id: 1,
  kind: 'chart',
  title: 'Wagon Wheel',
  artist: 'OCMS',
  source_url: null,
  original_content: 'ORIGINAL headed down south',
  rewritten_content: 'EDITED headed up north',
  changes_summary: null,
  llm_provider: null,
  llm_model: null,
  status: 'completed',
  current_version: 2,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
}));

// A song whose original and edited versions are identical: no toggle.
const UNEDITED_SONG = vi.hoisted<Song>(() => ({
  ...EDITED_SONG,
  uuid: 'unedited-uuid',
  title: 'As Imported',
  original_content: 'SAME words everywhere',
  rewritten_content: 'SAME words everywhere',
}));

const getSong = vi.hoisted(() => vi.fn());

vi.mock('@/api', () => ({
  default: {
    listSongs: vi.fn().mockResolvedValue([EDITED_SONG, UNEDITED_SONG]),
    getSong,
    getSongRevisions: vi.fn().mockResolvedValue([]),
    updateSong: vi.fn().mockResolvedValue(EDITED_SONG),
    // The library asks which tabs are kept on the device to render its markers.
    keptSongFiles: vi.fn().mockResolvedValue(new Set()),
  },
  STORAGE_KEYS: {
    PROVIDER: 'test_provider',
    MODEL: 'test_model',
    REASONING_EFFORT: 'test_effort',
    CURRENT_SONG_ID: 'test_song_id',
    PERFORMANCE_LAYOUT: 'test_perf_layout',
    PERFORMANCE_VERSION: 'test_perf_version',
  },
}));

const stubContext = {
  profile: { id: 1, is_default: true },
  onLoadSong: vi.fn(),
  setChatMessages: vi.fn(),
} as unknown as AppShellContext;

function ContextWrapper() {
  return <Outlet context={stubContext} />;
}

import LibraryTab from '@/components/LibraryTab';

function renderSong(uuid: string) {
  return render(
    <MemoryRouter initialEntries={[`/app/library/${uuid}`]}>
      <Routes>
        <Route path="/app" element={<ContextWrapper />}>
          <Route path="library/:id" element={<LibraryTab />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('LibraryTab performance version toggle', () => {
  beforeEach(() => {
    localStorage.clear();
    getSong.mockImplementation((uuid: string) =>
      Promise.resolve(uuid === 'unedited-uuid' ? UNEDITED_SONG : EDITED_SONG),
    );
  });

  it('defaults to the edited version and switches to the original on toggle', async () => {
    const user = userEvent.setup();
    renderSong('edited-uuid');

    await waitFor(() => {
      expect(screen.getByText(/EDITED headed up north/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/ORIGINAL headed down south/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Original' }));

    expect(screen.getByText(/ORIGINAL headed down south/)).toBeInTheDocument();
    expect(screen.queryByText(/EDITED headed up north/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Your Version' }));
    expect(screen.getByText(/EDITED headed up north/)).toBeInTheDocument();
  });

  it('hides the toggle when the original matches the edited version', async () => {
    renderSong('unedited-uuid');

    await waitFor(() => {
      expect(screen.getByText(/SAME words everywhere/)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Original' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Your Version' })).not.toBeInTheDocument();
  });

  it('remembers the last chosen version across songs', async () => {
    localStorage.setItem('test_perf_version', 'original');
    renderSong('edited-uuid');

    await waitFor(() => {
      expect(screen.getByText(/ORIGINAL headed down south/)).toBeInTheDocument();
    });
  });
});
