import { useEffect } from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { renderWithRouter } from '@/test/test-utils';
import type { Song } from '@/types';

const MOCK_SONG = vi.hoisted(
  () =>
    ({
      id: 7,
      uuid: 'song-uuid-7',
      user_id: 1,
      profile_id: 1,
      title: 'Amazing Grace',
      artist: 'John Newton',
      source_url: null,
      original_content: 'Amazing grace',
      rewritten_content: 'Amazing grace',
      changes_summary: null,
      llm_provider: null,
      llm_model: null,
      status: 'completed',
      current_version: 1,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    }) as Song,
);

// Mock auth context: ready state with no auth required
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    authState: 'ready',
    currentAuthUser: null,
    authConfig: { required: false },
    isPremium: false,
    handleLogout: vi.fn(),
  }),
}));

// Mock api module
vi.mock('@/api', () => ({
  default: {
    listProfiles: vi.fn().mockResolvedValue([{ id: 1, is_default: true }]),
    listModels: vi.fn().mockResolvedValue([]),
    getSong: vi.fn().mockResolvedValue(MOCK_SONG),
    getChatHistory: vi.fn().mockResolvedValue([]),
  },
  ConnectionLostError: class ConnectionLostError extends Error {},
  STORAGE_KEYS: {
    MODEL: 'test_model',
    REASONING_EFFORT: 'test_effort',
    CURRENT_SONG_ID: 'test_song_id',
    DRAFT_INPUT: 'test_draft_input',
    DRAFT_INSTRUCTION: 'test_draft_instruction',
    LAST_SURFACE: 'test_last_surface',
  },
}));

// Stub heavy children so the test focuses on layout structure
vi.mock('@/components/Header', () => ({
  default: () => <div data-testid="header">Header</div>,
}));
vi.mock('@/components/Tabs', () => ({
  default: ({ onNewSong }: { onNewSong?: () => void }) => (
    <div data-testid="tabs">
      <button onClick={onNewSong}>tab-new-song</button>
    </div>
  ),
}));
vi.mock('@/components/MobileNav', () => ({
  default: () => <div data-testid="mobile-nav">MobileNav</div>,
}));

import api from '@/api';
import AppShell from '@/layouts/AppShell';

const mockApi = api as unknown as {
  getSong: ReturnType<typeof vi.fn>;
  getChatHistory: ReturnType<typeof vi.fn>;
};

describe('AppShell layout', () => {
  it('wraps header and tabs in a sticky container', () => {
    renderWithRouter(<AppShell />, { route: '/app/rewrite' });

    const header = screen.getByTestId('header');
    const tabs = screen.getByTestId('tabs');

    // Header is a direct child of the sticky wrapper
    const stickyWrapper = header.parentElement!;
    expect(stickyWrapper.className).toContain('sticky');
    expect(stickyWrapper.className).toContain('top-0');
    expect(stickyWrapper.className).toContain('z-50');

    // Tabs are inside a hidden-on-mobile wrapper within the same sticky container
    const tabsDesktopWrapper = tabs.parentElement!;
    expect(tabsDesktopWrapper.className).toContain('hidden');
    expect(tabsDesktopWrapper.className).toContain('md:block');
    expect(tabsDesktopWrapper.parentElement).toBe(stickyWrapper);
  });

  it('renders footer with GitHub link', () => {
    renderWithRouter(<AppShell />, { route: '/app/rewrite' });

    const link = screen.getByRole('link', { name: 'GitHub' });
    expect(link).toHaveAttribute('href', 'https://github.com/Brake-Labs/porchsongs');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByText(/Made with/)).toBeInTheDocument();
  });

  it('renders footer with X (Twitter) link', () => {
    renderWithRouter(<AppShell />, { route: '/app/rewrite' });

    const link = screen.getByRole('link', { name: 'X (Twitter)' });
    expect(link).toHaveAttribute('href', 'https://x.com/natebrake');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('renders feature request link in footer', () => {
    renderWithRouter(<AppShell />, { route: '/app/rewrite' });

    const link = screen.getByRole('link', { name: /feature request/i });
    expect(link).toHaveAttribute('href');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('renders report issue link in footer', () => {
    renderWithRouter(<AppShell />, { route: '/app/rewrite' });

    const link = screen.getByRole('link', { name: /report issue/i });
    expect(link).toHaveAttribute('href');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('sets maximum-scale=1 on iOS to prevent auto-zoom', () => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!meta) {
      const m = document.createElement('meta');
      m.name = 'viewport';
      m.content = 'width=device-width, initial-scale=1.0';
      document.head.appendChild(m);
    }

    // Simulate iOS user agent
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
      configurable: true,
    });

    renderWithRouter(<AppShell />, { route: '/app/rewrite' });

    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    expect(viewport?.content).toContain('maximum-scale=1');

    // Restore user agent
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (X11; Linux x86_64)',
      configurable: true,
    });
  });

  describe('global New Song', () => {
    afterEach(() => {
      sessionStorage.clear();
    });

    it('starts a new song without confirmation when there is nothing to discard', async () => {
      renderWithRouter(<AppShell />, { route: '/app/library' });
      await screen.findByTestId('tabs');

      fireEvent.click(screen.getByRole('button', { name: 'tab-new-song' }));

      // No discardable work: skip the confirm dialog and start immediately.
      expect(screen.queryByText('Start New Song')).not.toBeInTheDocument();
    });

    it('confirms before discarding typed-but-unimported draft lyrics', async () => {
      sessionStorage.setItem('test_draft_input', 'some pasted lyrics');
      renderWithRouter(<AppShell />, { route: '/app/library' });
      await screen.findByTestId('tabs');

      fireEvent.click(screen.getByRole('button', { name: 'tab-new-song' }));

      // A non-empty INPUT draft is genuinely unsaved, so confirm first.
      expect(screen.getByText('Discard unsaved lyrics?')).toBeInTheDocument();
      expect(
        screen.getByText(/lyrics you pasted haven't been imported yet/),
      ).toBeInTheDocument();
    });

    it('treats a whitespace-only draft as nothing to discard', async () => {
      sessionStorage.setItem('test_draft_input', '   \n  ');
      renderWithRouter(<AppShell />, { route: '/app/library' });
      await screen.findByTestId('tabs');

      fireEvent.click(screen.getByRole('button', { name: 'tab-new-song' }));

      expect(screen.queryByText('Start New Song')).not.toBeInTheDocument();
    });

    it('clears the draft keys when a new song is started', async () => {
      sessionStorage.setItem('test_draft_input', 'some pasted lyrics');
      renderWithRouter(<AppShell />, { route: '/app/library' });
      await screen.findByTestId('tabs');

      fireEvent.click(screen.getByRole('button', { name: 'tab-new-song' }));
      // Confirm the discard.
      fireEvent.click(screen.getByRole('button', { name: 'Start new song' }));

      expect(sessionStorage.getItem('test_draft_input')).toBeNull();
    });
  });

  /**
   * PWA relaunch restore (issue #274).
   *
   * manifest.json's start_url is /app, so an installed app always cold-launches
   * there, the index route immediately redirects to /app/library, and the
   * restore effect then decides whether to move somewhere else.
   */
  describe('PWA relaunch surface restore', () => {
    beforeEach(() => {
      mockApi.getSong.mockClear();
      mockApi.getChatHistory.mockClear();
    });

    afterEach(() => {
      localStorage.removeItem('test_song_id');
      localStorage.removeItem('test_last_surface');
    });

    /**
     * Stands in for LibraryTab, which records itself as the last surface the
     * moment it mounts. That write lands before the restore's `getSong` resolves,
     * so it is the reason the restore must sample LAST_SURFACE on the first
     * render rather than reading it later. LibraryTab's own write is covered in
     * LibraryTab.navigation.test.tsx.
     */
    function LibrarySurfaceStub() {
      useEffect(() => {
        localStorage.setItem('test_last_surface', 'library');
      }, []);
      return <div data-testid="library-surface">library</div>;
    }

    function LocationProbe() {
      return <div data-testid="pathname">{useLocation().pathname}</div>;
    }

    function renderLaunch(entry: string) {
      return render(
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/app" element={<AppShell />}>
              <Route index element={<Navigate to="/app/library" replace />} />
              <Route path="library" element={<LibrarySurfaceStub />} />
              <Route path="rewrite" element={<div data-testid="rewrite-surface" />} />
              <Route path="play/:uuid" element={<div data-testid="play-surface" />} />
            </Route>
          </Routes>
          <LocationProbe />
        </MemoryRouter>,
      );
    }

    /**
     * Resolves once the restore has run to completion, so a "stayed put"
     * assertion cannot pass simply by being made too early. The restore
     * navigates (or decides not to) in the continuation after `getChatHistory`.
     */
    async function restoreSettled() {
      await waitFor(() => expect(mockApi.getChatHistory).toHaveBeenCalled());
      await act(async () => {
        await Promise.resolve();
      });
    }

    const expectPath = (pathname: string) =>
      expect(screen.getByTestId('pathname')).toHaveTextContent(pathname);

    it('returns to the chart when the user quit mid-performance', async () => {
      localStorage.setItem('test_song_id', MOCK_SONG.uuid);
      localStorage.setItem('test_last_surface', 'play');

      renderLaunch('/app');
      await restoreSettled();

      expectPath(`/app/play/${MOCK_SONG.uuid}`);
    });

    it('returns to the workshop when the user quit while workshopping', async () => {
      localStorage.setItem('test_song_id', MOCK_SONG.uuid);
      localStorage.setItem('test_last_surface', 'workshop');

      renderLaunch('/app');
      await restoreSettled();

      // The library mounts first and overwrites LAST_SURFACE with 'library', so
      // this only holds if the restore sampled the value before any surface
      // could clobber it.
      expectPath('/app/rewrite');
    });

    it('stays in the library when the user quit from the library', async () => {
      localStorage.setItem('test_song_id', MOCK_SONG.uuid);
      localStorage.setItem('test_last_surface', 'library');

      renderLaunch('/app');
      await restoreSettled();

      expectPath('/app/library');
    });

    it('lands on the library when no surface was ever recorded', async () => {
      localStorage.setItem('test_song_id', MOCK_SONG.uuid);

      renderLaunch('/app');
      await restoreSettled();

      // The library is the app's front door. An open song is still restored into
      // memory, but an unrecognised surface must not drag the user off it.
      expectPath('/app/library');
    });

    it('leaves a reload of a real route where it is', async () => {
      localStorage.setItem('test_song_id', MOCK_SONG.uuid);
      localStorage.setItem('test_last_surface', 'play');

      renderLaunch('/app/library');
      await restoreSettled();

      // Not a relaunch: the user is already somewhere specific.
      expectPath('/app/library');
    });
  });
});
